//! Notification channel adapters — outbound delivery for the 5 channels.
//!
//! Each adapter takes system_config (admin secrets) + destination
//! (per-user) + event_type + payload. Returns `ChannelResult`.
//!
//! All HTTP outbound goes through the shared `reqwest::Client` (rustls,
//! aws-lc-rs) — never spinning up a new client per call. SMTP outbound
//! uses `lettre` configured for rustls + aws-lc-rs.
//!
//! Config shapes (all stored as JSONB in `notification_channels.config`
//! and `user_notification_channels.destination`):
//!
//!  - `email`:
//!      system     = `{ host, port, username, password, from, use_tls }`
//!      destination = `{ to }`
//!  - `ntfy`:
//!      system     = `{ server_url, auth_header? }`
//!      destination = `{ topic }`
//!  - `webhook`:
//!      system     = `{}`
//!      destination = `{ url, auth_header? }`
//!  - `apprise`:
//!      system     = `{ server_url, auth_header? }`
//!      destination = `{ urls: ["tgram://...", "ntfys://..."] }`
//!  - `browser_push`:
//!      system     = `{ vapid_public_key, vapid_private_key, vapid_subject }`
//!      destination = handled per-subscription via `web_push_subscriptions`

use crate::domain::notification;
use crate::state::AppState;
use lettre::message::header::ContentType;
use lettre::transport::smtp::authentication::Credentials;
use lettre::{AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor};
use std::net::IpAddr;
use std::str::FromStr;
use thiserror::Error;
use uuid::Uuid;

// =============================================================================
// SSRF guards — every outbound HTTP call whose URL or hostname comes from a
// user (webhook destination) or admin (ntfy/apprise server_url) goes through
// `validate_outbound_url` BEFORE the request is built, and through the
// no-redirect HTTP client in AppState (`state.http_no_redirect`) so a 30x
// response can't bounce us to an internal IP after the up-front check.
// =============================================================================

/// Reject URLs whose target is loopback, private/RFC-1918, link-local,
/// multicast, broadcast, unspecified, carrier-grade NAT, or a known alias
/// hostname for loopback. Domain-name URLs are RESOLVED via DNS and every
/// returned address is run through the same forbidden-IP check, so a
/// hostname like `postgres` or `169-254-169-254.nip.io` that maps to an
/// internal/metadata IP is rejected up front. Pinning the resolved IP into
/// the connect step would additionally close the TOCTOU/DNS-rebinding window
/// between this check and the actual request — that is a further hardening
/// step; this resolve-and-check is the baseline guard.
pub(crate) async fn validate_outbound_url(url: &str) -> Result<(), ChannelError> {
    let parsed = reqwest::Url::parse(url)
        .map_err(|e| ChannelError::Misconfigured(format!("invalid URL: {e}")))?;

    // Scheme allow-list — blocks file://, gopher://, javascript:, data:, etc.
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err(ChannelError::Misconfigured(format!(
            "scheme '{}' not allowed (use http or https)",
            parsed.scheme()
        )));
    }

    // Use `Url::host()` rather than `host_str()` — the latter returns the
    // raw URL slice and KEEPS the IPv6 brackets ("[::1]") so an
    // `IpAddr::from_str` parse would silently fail and let loopback v6
    // through. `host()` returns a parsed enum we can match against.
    let host = parsed
        .host()
        .ok_or_else(|| ChannelError::Misconfigured("URL has no host".into()))?;
    match host {
        url::Host::Ipv4(v4) => {
            if is_blocked_ip(&IpAddr::V4(v4)) {
                return Err(ChannelError::Misconfigured(format!(
                    "IP '{v4}' targets a private/loopback/link-local range"
                )));
            }
        }
        url::Host::Ipv6(v6) => {
            if is_blocked_ip(&IpAddr::V6(v6)) {
                return Err(ChannelError::Misconfigured(format!(
                    "IP '{v6}' targets a private/loopback/link-local range"
                )));
            }
        }
        url::Host::Domain(name) => {
            let lower = name.to_ascii_lowercase();
            const BANNED_HOSTNAMES: &[&str] = &[
                "localhost",
                "ip6-localhost",
                "ip6-loopback",
                "broadcasthost",
            ];
            if BANNED_HOSTNAMES.contains(&lower.as_str()) || lower.ends_with(".localhost") {
                return Err(ChannelError::Misconfigured(format!(
                    "host '{name}' is not allowed"
                )));
            }
            // If the admin/user typed a numeric hostname that the URL parser
            // didn't recognise as an IP (e.g. trailing dot), we still try the
            // `IpAddr::from_str` fallback to catch the dotted-decimal case.
            if let Ok(ip) = IpAddr::from_str(&lower) {
                if is_blocked_ip(&ip) {
                    return Err(ChannelError::Misconfigured(format!(
                        "IP '{ip}' targets a private/loopback/link-local range"
                    )));
                }
            }
            // Resolve the hostname and run the same forbidden-IP check on
            // every address it maps to. This catches DNS names that point at
            // internal hosts (`postgres`, `169-254-169-254.nip.io`, …) which
            // the literal/alias checks above can't see. Note: the resolution
            // here is advisory — pinning the chosen IP into the connect step
            // would also close the DNS-rebinding window; see fn doc-comment.
            let port = parsed.port_or_known_default().unwrap_or(80);
            let resolved = tokio::net::lookup_host((lower.as_str(), port))
                .await
                .map_err(|e| {
                    ChannelError::Misconfigured(format!("host '{name}' did not resolve: {e}"))
                })?;
            let mut saw_any = false;
            for addr in resolved {
                saw_any = true;
                if is_blocked_ip(&addr.ip()) {
                    return Err(ChannelError::Misconfigured(format!(
                        "host '{name}' resolves to '{}', a private/loopback/link-local range",
                        addr.ip()
                    )));
                }
            }
            if !saw_any {
                return Err(ChannelError::Misconfigured(format!(
                    "host '{name}' resolved to no addresses"
                )));
            }
        }
    }

    Ok(())
}

/// DNS-rebinding guard for reqwest. `validate_outbound_url` resolves + checks a
/// URL up front, but reqwest resolves AGAIN at connect time — a short-TTL
/// attacker DNS could answer a public IP during the check and a private/metadata
/// IP at connect (TOCTOU / rebinding). Attaching this resolver to the outbound
/// notification client makes reqwest's OWN connect-time resolution run through
/// the same `is_blocked_ip` denylist: a single guarded resolution, and reqwest
/// connects only to allowed addresses. Wired to `http_no_redirect` in main.rs —
/// NOT the main client, which must still reach a self-hosted internal OIDC IdP.
pub struct GuardedDnsResolver;

impl reqwest::dns::Resolve for GuardedDnsResolver {
    fn resolve(&self, name: reqwest::dns::Name) -> reqwest::dns::Resolving {
        Box::pin(async move {
            let host = name.as_str().to_owned();
            // Port 0 — reqwest overrides it with the real target port.
            let addrs = tokio::net::lookup_host((host.as_str(), 0)).await?;
            let allowed: Vec<std::net::SocketAddr> =
                addrs.filter(|a| !is_blocked_ip(&a.ip())).collect();
            if allowed.is_empty() {
                return Err(format!(
                    "all resolved addresses for '{host}' target a blocked \
                     (private/loopback/link-local/metadata) range"
                )
                .into());
            }
            Ok(Box::new(allowed.into_iter()) as reqwest::dns::Addrs)
        })
    }
}

fn is_blocked_ip(ip: &IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            v4.is_loopback()
                || v4.is_private()
                || v4.is_link_local()
                || v4.is_broadcast()
                || v4.is_multicast()
                || v4.is_unspecified()
                || v4.is_documentation()
                // Carrier-grade NAT: 100.64.0.0/10
                || (v4.octets()[0] == 100 && (v4.octets()[1] & 0xc0) == 0x40)
        }
        IpAddr::V6(v6) => {
            v6.is_loopback()
                || v6.is_unspecified()
                || v6.is_multicast()
                // Unique-local (fc00::/7)
                || (v6.segments()[0] & 0xfe00) == 0xfc00
                // Link-local (fe80::/10)
                || (v6.segments()[0] & 0xffc0) == 0xfe80
                // IPv4-mapped (::ffff:0:0/96) — recurse on the embedded V4.
                || v6
                    .to_ipv4_mapped()
                    .is_some_and(|v4| is_blocked_ip(&IpAddr::V4(v4)))
        }
    }
}

/// ntfy topic names must be safe to drop into the URL path without enabling
/// path traversal (`../`) or auth-bypass via `@user:pass@otherhost`. We
/// require alphanumerics + `_` + `-`, matching the ntfy spec.
fn validate_ntfy_topic(topic: &str) -> Result<(), ChannelError> {
    if topic.is_empty() {
        return Err(ChannelError::Misconfigured("ntfy topic is empty".into()));
    }
    if topic.len() > 64 {
        return Err(ChannelError::Misconfigured(
            "ntfy topic too long (max 64 chars)".into(),
        ));
    }
    let valid = topic
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-');
    if !valid {
        return Err(ChannelError::Misconfigured(
            "ntfy topic must contain only alphanumerics, '-' or '_'".into(),
        ));
    }
    Ok(())
}

#[derive(Debug, Error)]
pub enum ChannelError {
    #[error("misconfigured: {0}")]
    Misconfigured(String),
    #[error("upstream error: {0}")]
    Upstream(String),
}

pub type ChannelResult = Result<(), ChannelError>;

/// Dispatch an event to a single channel. Looks up the adapter by
/// `channel_type` and delegates. Returns ChannelError on failure.
#[allow(clippy::too_many_arguments)]
pub async fn dispatch_to_channel(
    state: &AppState,
    user_id: Uuid,
    channel_type: &str,
    system_config: &serde_json::Value,
    destination: &serde_json::Value,
    event_type: &str,
    payload: &serde_json::Value,
    // The recipient's `users.locale`, resolved once by the caller so a
    // six-channel fan-out doesn't hit the DB six times.
    locale: &str,
) -> ChannelResult {
    let msg = render_message(event_type, payload, &state.config.frontend_url, locale);
    match channel_type {
        notification::CHANNEL_EMAIL => send_email(system_config, destination, &msg).await,
        notification::CHANNEL_NTFY => send_ntfy(state, system_config, destination, &msg).await,
        notification::CHANNEL_WEBHOOK => {
            send_webhook(state, destination, event_type, payload, &msg).await
        }
        notification::CHANNEL_APPRISE => send_apprise(state, system_config, destination, &msg).await,
        notification::CHANNEL_BROWSER_PUSH => {
            send_browser_push(state, user_id, system_config, event_type, payload, &msg).await
        }
        other => Err(ChannelError::Misconfigured(format!(
            "unknown channel: {other}"
        ))),
    }
}

// =============================================================================
// Message rendering — server-side fallback for when an external channel
// needs a pre-formatted title + body. The SPA does its own i18n for the
// in-app surface; this is just for plain-text adapters (email subject,
// ntfy title, etc.) and uses English copy.
// =============================================================================

#[derive(Debug, Clone)]
pub struct RenderedMessage {
    pub title: String,
    pub body: String,
}

/// Render one event into a channel-agnostic title + plain-text body.
///
/// `base` is the canonical SPA origin (`FRONTEND_URL`) so every message can
/// deep-link back to the thing it is about — a notification you can't act on
/// is noise. `locale` is the recipient's `users.locale`; anything that isn't
/// `fr*` falls back to English.
///
/// Plain text only: ntfy, webhooks and Apprise don't render HTML, and the
/// email adapter sends this same body as text.
fn render_message(
    event_type: &str,
    payload: &serde_json::Value,
    base: &str,
    locale: &str,
) -> RenderedMessage {
    let get_str = |k: &str| {
        payload
            .get(k)
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string()
    };
    let fr = locale.starts_with("fr");
    let base = base.trim_end_matches('/');
    let link = |path: &str| format!("{base}{path}");
    // A figure deep-link, falling back to the catalogue when the payload
    // carries no id (older rows, hand-fired events).
    let figure_link = || {
        let id = get_str("figure_id");
        if id.is_empty() {
            link("/catalogue")
        } else {
            link(&format!("/figures/{id}"))
        }
    };

    match event_type {
        "test" => RenderedMessage {
            title: "FigureCollector — test".to_string(),
            body: if fr {
                "Si tu peux lire ce message, ton canal de notifications est correctement configuré. Tu peux fermer ce test.".to_string()
            } else {
                "If you can read this, your notification channel is set up correctly. You can close this test.".to_string()
            },
        },

        notification::EVENT_ACHIEVEMENT_UNLOCKED => {
            let code = get_str("code");
            let tier = get_str("tier");
            let url = link("/achievements");
            RenderedMessage {
                title: if fr {
                    format!("FigureCollector — nouveau sceau : {code}")
                } else {
                    format!("FigureCollector — new seal pressed: {code}")
                },
                body: if fr {
                    format!("Tu viens de débloquer le succès « {code} » (palier : {tier}).\n\n{url}")
                } else {
                    format!("You just unlocked the “{code}” achievement (tier: {tier}).\n\n{url}")
                },
            }
        }

        notification::EVENT_PREORDER_RELEASE_TODAY => {
            let name = get_str("figure_name");
            let date = get_str("release_date");
            let url = link("/collection/preorders");
            RenderedMessage {
                title: if fr {
                    format!("FigureCollector — sortie aujourd'hui : {name}")
                } else {
                    format!("FigureCollector — released today: {name}")
                },
                body: if fr {
                    format!("{name} sort aujourd'hui ({date}). Ta précommande est la prochaine sur la liste.\n\n{url}")
                } else {
                    format!("{name} is releasing today ({date}). Your pre-order is next on the list.\n\n{url}")
                },
            }
        }

        notification::EVENT_PREORDER_RELEASE_J7 => {
            let name = get_str("figure_name");
            let date = get_str("release_date");
            let url = link("/collection/preorders");
            RenderedMessage {
                title: if fr {
                    format!("FigureCollector — sortie imminente : {name}")
                } else {
                    format!("FigureCollector — releasing soon: {name}")
                },
                body: if fr {
                    format!("Dans 7 jours : {name} sort le {date}. Vérifie que ton paiement et ton adresse sont à jour chez le vendeur.\n\n{url}")
                } else {
                    format!("Heads-up: {name} releases in 7 days ({date}). Make sure your payment and address are up to date with the seller.\n\n{url}")
                },
            }
        }

        notification::EVENT_PREORDER_DELIVERY_TODAY => {
            let name = get_str("figure_name");
            let date = get_str("delivery_date");
            let url = link("/collection/preorders");
            RenderedMessage {
                title: if fr {
                    format!("FigureCollector — livraison prévue aujourd'hui : {name}")
                } else {
                    format!("FigureCollector — arriving today: {name}")
                },
                body: if fr {
                    format!("{name} devrait arriver aujourd'hui ({date}). Pense à contrôler l'état du colis à la réception.\n\n{url}")
                } else {
                    format!("{name} should arrive today ({date}). Check the parcel's condition when you take delivery.\n\n{url}")
                },
            }
        }

        notification::EVENT_PREORDER_DELIVERY_OVERDUE => {
            let name = get_str("figure_name");
            let date = get_str("delivery_date");
            let url = link("/collection/preorders");
            RenderedMessage {
                title: if fr {
                    format!("FigureCollector — livraison en retard : {name}")
                } else {
                    format!("FigureCollector — delivery overdue: {name}")
                },
                body: if fr {
                    format!("{name} était attendu le {date} et n'est pas marqué comme reçu. C'est le moment de relancer le transporteur ou la boutique — les délais de réclamation sont courts.\n\n{url}")
                } else {
                    format!("{name} was due on {date} and isn't marked as received yet. Time to chase the carrier or the shop — claim windows are short.\n\n{url}")
                },
            }
        }

        notification::EVENT_WISHLIST_PRICE_BELOW_TARGET => {
            let name = get_str("figure_name");
            let amount = get_str("amount");
            let currency = get_str("currency");
            let target = get_str("target_amount");
            let target_currency = get_str("target_currency");
            let url = figure_link();
            RenderedMessage {
                title: if fr {
                    format!("FigureCollector — prix cible atteint : {name}")
                } else {
                    format!("FigureCollector — price target hit: {name}")
                },
                body: if fr {
                    format!("{name} est à {amount} {currency} — au niveau ou sous ta cible de {target} {target_currency}.\n\n{url}")
                } else {
                    format!("{name} is now at {amount} {currency} — at or under your {target} {target_currency} target.\n\n{url}")
                },
            }
        }

        notification::EVENT_WISHLIST_BACK_IN_STOCK => {
            let name = get_str("figure_name");
            let shop = get_str("store_name");
            let preorder = get_str("status") == "preorder";
            let url = figure_link();
            RenderedMessage {
                title: if fr {
                    format!("FigureCollector — de retour en stock : {name}")
                } else {
                    format!("FigureCollector — back in stock: {name}")
                },
                body: match (fr, preorder) {
                    (true, false) => format!("{name} est de nouveau disponible chez {shop}. Un restock part vite.\n\n{url}"),
                    (true, true) => format!("{name} est repassé en précommande chez {shop}.\n\n{url}"),
                    (false, false) => format!("{name} is available again at {shop}. Restocks go fast.\n\n{url}"),
                    (false, true) => format!("{name} reopened for pre-order at {shop}.\n\n{url}"),
                },
            }
        }

        notification::EVENT_CLAIM_WINDOW_CLOSING => {
            let name = get_str("figure_name");
            let deadline = get_str("deadline");
            let days = payload.get("days_left").and_then(|v| v.as_i64()).unwrap_or(0);
            let carrier = get_str("which") == "carrier";
            let url = link("/collection");
            RenderedMessage {
                title: if fr {
                    format!("FigureCollector — réclamation : {name}")
                } else {
                    format!("FigureCollector — claim window closing: {name}")
                },
                body: match (fr, carrier) {
                    (true, false) => format!("La fenêtre de réclamation boutique (DOA) pour {name} ferme le {deadline} — dans {days} j.\n\n{url}"),
                    (true, true) => format!("Le délai de réclamation transporteur pour {name} expire le {deadline} — dans {days} j.\n\n{url}"),
                    (false, false) => format!("The shop's DOA window for {name} closes on {deadline} — {days} day(s) left.\n\n{url}"),
                    (false, true) => format!("The carrier claim window for {name} expires on {deadline} — {days} day(s) left.\n\n{url}"),
                },
            }
        }

        notification::EVENT_MANGA_SERVER_APPROVED => {
            let label = {
                let l = get_str("label");
                if l.is_empty() { get_str("base_url") } else { l }
            };
            let url = link("/settings");
            RenderedMessage {
                title: if fr {
                    format!("FigureCollector — serveur manga approuvé : {label}")
                } else {
                    format!("FigureCollector — manga server approved: {label}")
                },
                body: if fr {
                    format!("Un administrateur a approuvé {label} : ta synergie MangaCollector est active.\n\n{url}")
                } else {
                    format!("An admin approved {label}: your MangaCollector synergy is now active.\n\n{url}")
                },
            }
        }

        notification::EVENT_MANGA_SERVER_REVOKED => {
            let label = {
                let l = get_str("label");
                if l.is_empty() { get_str("base_url") } else { l }
            };
            let reason = get_str("reason");
            let url = link("/settings");
            let why_fr = if reason.is_empty() { String::new() } else { format!("\nMotif : {reason}") };
            let why_en = if reason.is_empty() { String::new() } else { format!("\nReason: {reason}") };
            RenderedMessage {
                title: if fr {
                    format!("FigureCollector — serveur manga révoqué : {label}")
                } else {
                    format!("FigureCollector — manga server revoked: {label}")
                },
                body: if fr {
                    format!("Un administrateur a révoqué {label} : la synergie est désactivée jusqu'à ce que tu en choisisses un autre.{why_fr}\n\n{url}")
                } else {
                    format!("An admin revoked {label}: the synergy is disabled until you pick another one.{why_en}\n\n{url}")
                },
            }
        }

        // Unknown event: still deliverable, but say so in words rather than
        // dumping JSON at the user.
        other => RenderedMessage {
            title: format!("FigureCollector — {other}"),
            body: if fr {
                format!("Événement : {other}\n\n{base}")
            } else {
                format!("Event: {other}\n\n{base}")
            },
        },
    }
}

// =============================================================================
// Email adapter — SMTP via lettre (rustls + aws-lc-rs)
// =============================================================================

async fn send_email(
    system: &serde_json::Value,
    destination: &serde_json::Value,
    msg: &RenderedMessage,
) -> ChannelResult {
    let host = system
        .get("host")
        .and_then(|v| v.as_str())
        .ok_or_else(|| ChannelError::Misconfigured("missing host".into()))?;
    let port = system
        .get("port")
        .and_then(|v| v.as_i64())
        .unwrap_or(587) as u16;
    let from = system
        .get("from")
        .and_then(|v| v.as_str())
        .ok_or_else(|| ChannelError::Misconfigured("missing from".into()))?;
    let username = system.get("username").and_then(|v| v.as_str());
    let password = system.get("password").and_then(|v| v.as_str());
    let use_tls = system
        .get("use_tls")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    let to = destination
        .get("to")
        .and_then(|v| v.as_str())
        .ok_or_else(|| ChannelError::Misconfigured("missing to address".into()))?;

    let mail = Message::builder()
        .from(
            from.parse()
                .map_err(|e: lettre::address::AddressError| {
                    ChannelError::Misconfigured(format!("bad From: {e}"))
                })?,
        )
        .to(to
            .parse()
            .map_err(|e: lettre::address::AddressError| {
                ChannelError::Misconfigured(format!("bad To: {e}"))
            })?)
        .subject(&msg.title)
        .header(ContentType::TEXT_PLAIN)
        .body(msg.body.clone())
        .map_err(|e| ChannelError::Upstream(format!("message build failed: {e}")))?;

    // Two transport variants: implicit TLS (port 465) vs STARTTLS (port
    // 587). The admin picks via `use_tls`.
    let mut builder = if use_tls {
        AsyncSmtpTransport::<Tokio1Executor>::relay(host)
            .map_err(|e| ChannelError::Misconfigured(format!("SMTP relay setup: {e}")))?
    } else {
        AsyncSmtpTransport::<Tokio1Executor>::starttls_relay(host)
            .map_err(|e| ChannelError::Misconfigured(format!("SMTP STARTTLS setup: {e}")))?
    };
    builder = builder.port(port);
    if let (Some(u), Some(p)) = (username, password) {
        if !u.is_empty() {
            builder = builder.credentials(Credentials::new(u.to_string(), p.to_string()));
        }
    }
    let mailer = builder.build();
    mailer
        .send(mail)
        .await
        .map_err(|e| ChannelError::Upstream(format!("SMTP send: {e}")))?;
    Ok(())
}

// =============================================================================
// ntfy adapter — POST to {server_url}/{topic} with plain-text body and
// an X-Title header.
// =============================================================================

async fn send_ntfy(
    state: &AppState,
    system: &serde_json::Value,
    destination: &serde_json::Value,
    msg: &RenderedMessage,
) -> ChannelResult {
    let server_url = system
        .get("server_url")
        .and_then(|v| v.as_str())
        .unwrap_or("https://ntfy.sh")
        .trim_end_matches('/');
    let topic = destination
        .get("topic")
        .and_then(|v| v.as_str())
        .ok_or_else(|| ChannelError::Misconfigured("missing ntfy topic".into()))?;

    // SSRF guard on the admin-set server URL + format guard on the user-set
    // topic (path traversal / @host injection via the format!() below).
    validate_outbound_url(server_url).await?;
    validate_ntfy_topic(topic)?;

    let url = format!("{server_url}/{topic}");
    let mut req = state
        .http_no_redirect
        .post(&url)
        .header("Title", &msg.title)
        .header("Priority", "default")
        .header("Tags", "package")
        .body(msg.body.clone());

    if let Some(auth) = system.get("auth_header").and_then(|v| v.as_str()) {
        if !auth.is_empty() {
            req = req.header("Authorization", auth);
        }
    }

    let res = req
        .send()
        .await
        .map_err(|e| ChannelError::Upstream(format!("ntfy POST: {e}")))?;
    if !res.status().is_success() {
        return Err(ChannelError::Upstream(format!(
            "ntfy returned {}",
            res.status()
        )));
    }
    Ok(())
}

// =============================================================================
// Webhook adapter — POST JSON to user-controlled URL.
// =============================================================================

async fn send_webhook(
    state: &AppState,
    destination: &serde_json::Value,
    event_type: &str,
    payload: &serde_json::Value,
    msg: &RenderedMessage,
) -> ChannelResult {
    let url = destination
        .get("url")
        .and_then(|v| v.as_str())
        .ok_or_else(|| ChannelError::Misconfigured("missing webhook URL".into()))?;

    // SSRF guard — refuses loopback / private / link-local / multicast / 0.0.0.0
    // and `localhost`-style aliases. Combined with the no-redirect client this
    // means an attacker can't (a) point a webhook at http://169.254.169.254/...
    // to read cloud metadata, (b) probe internal services on the Docker
    // network, or (c) bounce via a 302 from an attacker-controlled host.
    validate_outbound_url(url).await?;

    let body = serde_json::json!({
        "event_type": event_type,
        "title": msg.title,
        "body": msg.body,
        "payload": payload,
    });

    let mut req = state.http_no_redirect.post(url).json(&body);
    if let Some(auth) = destination.get("auth_header").and_then(|v| v.as_str()) {
        if !auth.is_empty() {
            req = req.header("Authorization", auth);
        }
    }
    let res = req
        .send()
        .await
        .map_err(|e| ChannelError::Upstream(format!("webhook POST: {e}")))?;
    if !res.status().is_success() {
        return Err(ChannelError::Upstream(format!(
            "webhook returned {}",
            res.status()
        )));
    }
    Ok(())
}

// =============================================================================
// Apprise adapter — POST to {server_url}/notify with JSON.
// =============================================================================

async fn send_apprise(
    state: &AppState,
    system: &serde_json::Value,
    destination: &serde_json::Value,
    msg: &RenderedMessage,
) -> ChannelResult {
    let server_url = system
        .get("server_url")
        .and_then(|v| v.as_str())
        .ok_or_else(|| ChannelError::Misconfigured("missing Apprise server_url".into()))?
        .trim_end_matches('/');
    // Defense in depth — even though the Apprise URL is admin-controlled, an
    // attacker who gains admin (or a misconfiguration) can't pivot to the
    // metadata service through the Apprise sidecar.
    validate_outbound_url(server_url).await?;
    let urls = destination
        .get("urls")
        .ok_or_else(|| ChannelError::Misconfigured("missing apprise URLs".into()))?;
    let urls_str = if let Some(arr) = urls.as_array() {
        arr.iter()
            .filter_map(|v| v.as_str())
            .collect::<Vec<_>>()
            .join(",")
    } else if let Some(s) = urls.as_str() {
        s.to_string()
    } else {
        return Err(ChannelError::Misconfigured(
            "apprise urls must be an array or string".into(),
        ));
    };
    if urls_str.is_empty() {
        return Err(ChannelError::Misconfigured("apprise urls is empty".into()));
    }

    let url = format!("{server_url}/notify");
    let mut req = state.http_no_redirect.post(&url).json(&serde_json::json!({
        "urls": urls_str,
        "title": msg.title,
        "body": msg.body,
        "type": "info",
    }));
    if let Some(auth) = system.get("auth_header").and_then(|v| v.as_str()) {
        if !auth.is_empty() {
            req = req.header("Authorization", auth);
        }
    }
    let res = req
        .send()
        .await
        .map_err(|e| ChannelError::Upstream(format!("apprise POST: {e}")))?;
    if !res.status().is_success() {
        return Err(ChannelError::Upstream(format!(
            "apprise returned {}",
            res.status()
        )));
    }
    Ok(())
}

// =============================================================================
// Web Push adapter — fans out to every subscription the user has
// registered. Uses the `web-push` crate's hyper client (rustls).
// =============================================================================

async fn send_browser_push(
    state: &AppState,
    user_id: Uuid,
    system: &serde_json::Value,
    event_type: &str,
    payload: &serde_json::Value,
    msg: &RenderedMessage,
) -> ChannelResult {
    use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
    use web_push_native::{
        WebPushBuilder, jwt_simple::algorithms::ES256KeyPair, p256::PublicKey,
    };

    // ----- Load admin-supplied VAPID config -----
    let pem = system
        .get("vapid_private_key")
        .and_then(|v| v.as_str())
        .ok_or_else(|| ChannelError::Misconfigured("missing VAPID private key".into()))?;
    let subject = system
        .get("vapid_subject")
        .and_then(|v| v.as_str())
        .unwrap_or("mailto:admin@figurecollector.local");

    // jwt-simple's PEM parser accepts both PKCS#8 ("BEGIN PRIVATE KEY")
    // and SEC1 ("BEGIN EC PRIVATE KEY") — our admin generator emits
    // PKCS#8 so the happy path is direct.
    let keypair = ES256KeyPair::from_pem(pem)
        .map_err(|e| ChannelError::Misconfigured(format!("VAPID PEM parse: {e}")))?;

    // ----- Load every push subscription the user has registered -----
    let subs = notification::list_push_subs(&state.pool, user_id)
        .await
        .map_err(|e| ChannelError::Upstream(format!("list subs: {e}")))?;
    if subs.is_empty() {
        return Ok(());
    }

    // ----- Compose the payload the SW receives -----
    let body_json = serde_json::to_vec(&serde_json::json!({
        "event_type": event_type,
        "title": msg.title,
        "body":  msg.body,
        "payload": payload,
    }))
    .map_err(|e| ChannelError::Upstream(format!("payload encode: {e}")))?;

    // ----- Fan out to each device endpoint -----
    for sub in &subs {
        // SSRF guard. `sub.endpoint` is whatever the browser registered via
        // POST /me/web-push/subscribe — fully user-controlled. Run it through
        // the same loopback / RFC-1918 / link-local / metadata check the other
        // outbound channels use, so a user can't register
        // `http://169.254.169.254/...` (or an internal Docker host) and have
        // the server fetch it. A bad endpoint is dropped like a dead one.
        if let Err(e) = validate_outbound_url(&sub.endpoint).await {
            tracing::warn!(error = %e, sub_id = %sub.id, "push endpoint blocked by SSRF guard, deleting");
            let _ = notification::delete_push(&state.pool, user_id, sub.id).await;
            continue;
        }

        // Browser-sent p256dh / auth are base64url-no-pad (per the Push
        // API spec). web-push-native takes raw bytes — decode here.
        let p256dh_bytes = match URL_SAFE_NO_PAD.decode(&sub.p256dh) {
            Ok(b) => b,
            Err(e) => {
                tracing::warn!(error = ?e, sub_id = %sub.id, "bad p256dh in subscription, deleting");
                let _ = notification::delete_push(&state.pool, user_id, sub.id).await;
                continue;
            }
        };
        let auth_bytes = match URL_SAFE_NO_PAD.decode(&sub.auth) {
            Ok(b) => b,
            Err(e) => {
                tracing::warn!(error = ?e, sub_id = %sub.id, "bad auth in subscription, deleting");
                let _ = notification::delete_push(&state.pool, user_id, sub.id).await;
                continue;
            }
        };
        let pubkey = match PublicKey::from_sec1_bytes(&p256dh_bytes) {
            Ok(k) => k,
            Err(e) => {
                tracing::warn!(error = ?e, sub_id = %sub.id, "p256dh not on curve, deleting");
                let _ = notification::delete_push(&state.pool, user_id, sub.id).await;
                continue;
            }
        };
        if auth_bytes.len() < 12 {
            tracing::warn!(sub_id = %sub.id, "auth shared secret too short, deleting");
            let _ = notification::delete_push(&state.pool, user_id, sub.id).await;
            continue;
        }

        // The endpoint URL is what the browser handed us; parse to http::Uri.
        // web-push-native uses the `http` crate's Uri type — we depend on
        // `http` directly to access it without reaching into the private
        // re-export.
        use std::str::FromStr;
        let uri = match http::Uri::from_str(&sub.endpoint) {
            Ok(u) => u,
            Err(e) => {
                tracing::warn!(error = ?e, sub_id = %sub.id, "bad endpoint URL, deleting");
                let _ = notification::delete_push(&state.pool, user_id, sub.id).await;
                continue;
            }
        };

        // Build the HTTP request — handles aes128gcm + VAPID JWT internally.
        let auth_arr = match try_to_auth(&auth_bytes) {
            Some(a) => a,
            None => continue,
        };
        let req = match WebPushBuilder::new(uri, pubkey, auth_arr)
            .with_vapid(&keypair, subject)
            .build(body_json.clone())
        {
            Ok(r) => r,
            Err(e) => {
                tracing::warn!(error = ?e, sub_id = %sub.id, "web-push build failed");
                continue;
            }
        };
        let (parts, body) = req.into_parts();

        // Reuse the no-redirect reqwest client (rustls / aws-lc-rs): a hostile
        // push service must not be able to 30x us onto an internal IP after
        // the up-front validate_outbound_url check (matches ntfy/webhook/apprise).
        let resp = match state
            .http_no_redirect
            .request(parts.method, parts.uri.to_string())
            .headers(parts.headers)
            .body(body)
            .send()
            .await
        {
            Ok(r) => r,
            Err(e) => {
                tracing::warn!(error = ?e, sub_id = %sub.id, "web-push send failed");
                continue;
            }
        };

        let status = resp.status();
        // 404 / 410 mean the subscription is dead on the push service's
        // side — clean it up so we don't keep retrying.
        if status == reqwest::StatusCode::NOT_FOUND || status == reqwest::StatusCode::GONE {
            tracing::info!(
                endpoint = sub.endpoint,
                status = status.as_u16(),
                "stale push subscription, removing"
            );
            let _ = notification::delete_push(&state.pool, user_id, sub.id).await;
        } else if !status.is_success() {
            let detail = resp
                .text()
                .await
                .unwrap_or_else(|_| "<no body>".to_string());
            tracing::warn!(
                status = status.as_u16(),
                detail = %detail,
                endpoint = sub.endpoint,
                "web-push delivery non-2xx"
            );
        } else {
            tracing::info!(
                status = status.as_u16(),
                endpoint = sub.endpoint,
                "web-push delivered"
            );
        }
    }

    Ok(())
}

/// web-push-native's `Auth` is `[u8; 16]` and the shared secret should
/// be exactly 16 bytes per RFC 8291. Some browsers historically sent
/// shorter / longer; we tolerate ≥16 by taking the first 16, but reject
/// anything shorter (caller already filtered <12).
fn try_to_auth(bytes: &[u8]) -> Option<web_push_native::Auth> {
    if bytes.len() < 16 {
        return None;
    }
    let mut a = web_push_native::Auth::default();
    a.copy_from_slice(&bytes[..16]);
    Some(a)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn ssrf_guard_blocks_loopback_v4() {
        for u in [
            "http://127.0.0.1/x",
            "https://127.0.0.1:8080/",
            "http://127.255.255.254/",
        ] {
            assert!(validate_outbound_url(u).await.is_err(), "should block {u}");
        }
    }

    #[tokio::test]
    async fn ssrf_guard_blocks_loopback_v6() {
        assert!(validate_outbound_url("http://[::1]/").await.is_err());
    }

    #[tokio::test]
    async fn ssrf_guard_blocks_link_local_metadata() {
        // AWS / GCP / Azure cloud-metadata IP — the classic SSRF target.
        assert!(
            validate_outbound_url("http://169.254.169.254/latest/meta-data/")
                .await
                .is_err()
        );
    }

    #[tokio::test]
    async fn ssrf_guard_blocks_rfc1918() {
        for u in [
            "http://10.0.0.1/",
            "http://172.16.0.1/",
            "http://192.168.1.1/",
        ] {
            assert!(validate_outbound_url(u).await.is_err(), "should block {u}");
        }
    }

    #[tokio::test]
    async fn ssrf_guard_blocks_unspecified_and_multicast() {
        assert!(validate_outbound_url("http://0.0.0.0/").await.is_err());
        assert!(validate_outbound_url("http://224.0.0.1/").await.is_err());
    }

    #[tokio::test]
    async fn ssrf_guard_blocks_carrier_grade_nat() {
        assert!(validate_outbound_url("http://100.64.0.1/").await.is_err());
        assert!(
            validate_outbound_url("http://100.127.255.254/")
                .await
                .is_err()
        );
        // 100.128.x.x is outside CGNAT, should pass IP-level check.
        assert!(validate_outbound_url("http://100.128.0.1/").await.is_ok());
    }

    #[tokio::test]
    async fn ssrf_guard_blocks_v6_unique_local_and_link_local() {
        assert!(validate_outbound_url("http://[fc00::1]/").await.is_err());
        assert!(validate_outbound_url("http://[fe80::1]/").await.is_err());
    }

    #[tokio::test]
    async fn ssrf_guard_blocks_v6_mapped_v4_loopback() {
        // IPv4-mapped IPv6 forms — must recurse on the embedded V4.
        assert!(
            validate_outbound_url("http://[::ffff:127.0.0.1]/")
                .await
                .is_err()
        );
        assert!(
            validate_outbound_url("http://[::ffff:169.254.169.254]/")
                .await
                .is_err()
        );
    }

    #[tokio::test]
    async fn ssrf_guard_blocks_localhost_aliases() {
        for u in [
            "http://localhost/",
            "https://LOCALHOST:8080/x",
            "http://ip6-localhost/",
            "http://ip6-loopback/",
            "http://anything.localhost/",
        ] {
            assert!(validate_outbound_url(u).await.is_err(), "should block {u}");
        }
    }

    #[tokio::test]
    async fn ssrf_guard_blocks_non_http_schemes() {
        for u in [
            "file:///etc/passwd",
            "gopher://example.com/",
            "javascript:alert(1)",
            "ftp://example.com/",
        ] {
            assert!(validate_outbound_url(u).await.is_err(), "should block {u}");
        }
    }

    // NOTE: a "happy path" DNS test (accepting public hostnames like
    // example.com) is intentionally omitted — the guard now performs a real
    // `lookup_host`, so such a test would depend on live DNS/network and be
    // flaky in CI. The forbidden-IP logic is exercised exhaustively above via
    // IP-literal inputs, which share the same `is_blocked_ip` check.

    #[test]
    fn ntfy_topic_rejects_traversal_and_meta_chars() {
        for t in [
            "../../etc/passwd",
            "topic/extra",
            "topic?query=1",
            "topic#frag",
            "topic@host",
            "topic with spaces",
            "",
        ] {
            assert!(validate_ntfy_topic(t).is_err(), "should reject {t:?}");
        }
    }

    #[test]
    fn ntfy_topic_accepts_alnum_dash_underscore() {
        for t in ["my-topic", "TOPIC_42", "abc"] {
            assert!(validate_ntfy_topic(t).is_ok(), "should accept {t:?}");
        }
    }

    #[test]
    fn ntfy_topic_rejects_oversized() {
        let too_long = "a".repeat(65);
        assert!(validate_ntfy_topic(&too_long).is_err());
    }
}

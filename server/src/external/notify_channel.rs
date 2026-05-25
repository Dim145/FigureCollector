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
use thiserror::Error;
use uuid::Uuid;

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
pub async fn dispatch_to_channel(
    state: &AppState,
    user_id: Uuid,
    channel_type: &str,
    system_config: &serde_json::Value,
    destination: &serde_json::Value,
    event_type: &str,
    payload: &serde_json::Value,
) -> ChannelResult {
    let msg = render_message(event_type, payload);
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

fn render_message(event_type: &str, payload: &serde_json::Value) -> RenderedMessage {
    let get_str = |k: &str| {
        payload
            .get(k)
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string()
    };
    match event_type {
        "test" => RenderedMessage {
            title: "FigureCollector — test de notification".to_string(),
            body: "Si tu peux lire ce message, ton canal de notifications est correctement configuré. Tu peux fermer ce test.".to_string(),
        },
        notification::EVENT_ACHIEVEMENT_UNLOCKED => {
            let code = get_str("code");
            let tier = get_str("tier");
            RenderedMessage {
                title: format!("FigureCollector — new seal pressed: {code}"),
                body: format!(
                    "You just unlocked the “{code}” achievement (tier: {tier}).\n\n\
                     Open https://figurecollector to admire it."
                ),
            }
        }
        notification::EVENT_PREORDER_RELEASE_TODAY => {
            let name = get_str("figure_name");
            let date = get_str("release_date");
            RenderedMessage {
                title: format!("FigureCollector — released today: {name}"),
                body: format!(
                    "{name} is releasing today ({date}). Your pre-order is the next on the list.",
                ),
            }
        }
        notification::EVENT_PREORDER_RELEASE_J7 => {
            let name = get_str("figure_name");
            let date = get_str("release_date");
            RenderedMessage {
                title: format!("FigureCollector — releasing soon: {name}"),
                body: format!(
                    "Heads-up: {name} releases in 7 days ({date}). Make sure your payment + address are up to date with the seller.",
                ),
            }
        }
        other => RenderedMessage {
            title: format!("FigureCollector — {other}"),
            body: format!("Event: {other}\nPayload: {payload}"),
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

    let url = format!("{server_url}/{topic}");
    let mut req = state
        .http
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

    let body = serde_json::json!({
        "event_type": event_type,
        "title": msg.title,
        "body": msg.body,
        "payload": payload,
    });

    let mut req = state.http.post(url).json(&body);
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
    let mut req = state.http.post(&url).json(&serde_json::json!({
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

        // Reuse the shared reqwest client (rustls / aws-lc-rs).
        let resp = match state
            .http
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

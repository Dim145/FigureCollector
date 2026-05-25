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
    _state: &AppState,
    _user_id: Uuid,
    _system: &serde_json::Value,
    _event_type: &str,
    _payload: &serde_json::Value,
    _msg: &RenderedMessage,
) -> ChannelResult {
    // Server-side VAPID delivery is stubbed pending a no-OpenSSL Web Push
    // implementation — the `web-push` crate transitively pulls in
    // openssl-sys via the `ece` crate (RFC 8291 aes128gcm). The
    // subscription endpoint + service worker + frontend permission flow
    // are all wired so a future replacement only needs to fill in this
    // function. Until then, fans-out through this adapter are a no-op;
    // users who subscribe via the SPA still get the in-app bell + any
    // other channels they've enabled.
    tracing::debug!("browser_push outbound delivery not yet implemented");
    Ok(())
}

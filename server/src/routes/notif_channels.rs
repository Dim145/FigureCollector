//! `/api/me/notification-channels` + `/api/me/notification-routes`
//! + `/api/admin/notification-channels`
//!
//! Three layers:
//!   - **Admin**: enables / configures channels at the system level
//!     (SMTP secrets, ntfy server URL + bearer, Apprise sidecar URL,
//!     VAPID keypair). Strictly admin-only.
//!   - **User channels**: each user picks which of the admin-enabled
//!     channels they want to use and provides their *destination* (their
//!     email address, their ntfy topic, their webhook URL).
//!   - **User routes**: maps event types to channels. The matrix lets a
//!     user say "achievements → in-app + push", "release J-7 → email".

use crate::auth;
use crate::domain::notification;
use crate::error::AppResult;
use crate::state::AppState;
use axum::{
    Json, Router,
    extract::{Path, State},
    http::StatusCode,
    routing::{get, patch as patch_method, put},
};
use serde::Deserialize;
use serde_json::Value;
use tower_sessions::Session;

// =============================================================================
// Per-user channels
// =============================================================================

#[derive(Debug, serde::Serialize)]
struct UserChannelsResponse {
    /// One entry per channel type the admin has registered (whether
    /// admin-enabled or not). Lets the SPA render a card for every
    /// channel, greyed-out if the admin hasn't activated it.
    system: Vec<notification::ChannelConfig>,
    /// The viewer's per-channel subscriptions (destination + enabled).
    mine: Vec<notification::UserChannel>,
}

async fn list_user_channels(
    State(state): State<AppState>,
    session: Session,
) -> AppResult<Json<UserChannelsResponse>> {
    let user_id = auth::require_user(&session).await?;
    let system = notification::list_channels(&state.pool).await?;
    // Public-facing copy strips the system `config` JSON — that holds
    // SMTP passwords and VAPID private keys. The SPA only needs the
    // enabled flag + the channel type to render cards.
    let system = system
        .into_iter()
        .map(|mut c| {
            c.config = redact_system_config(&c.channel_type, c.config);
            c
        })
        .collect();
    let mine = notification::list_user_channels(&state.pool, user_id).await?;
    Ok(Json(UserChannelsResponse { system, mine }))
}

/// Strip secrets out of the system config before sending it to a
/// non-admin viewer. We only ever emit the *public* fields each channel
/// needs (e.g. the VAPID public key, the ntfy server hostname). The
/// admin route uses a separate handler that doesn't redact.
fn redact_system_config(channel_type: &str, config: Value) -> Value {
    use serde_json::json;
    let obj = config.as_object().cloned().unwrap_or_default();
    let take = |k: &str| obj.get(k).cloned();
    match channel_type {
        notification::CHANNEL_BROWSER_PUSH => json!({
            // public key is fine to expose — that's literally its purpose
            "vapid_public_key": take("vapid_public_key"),
        }),
        notification::CHANNEL_EMAIL => json!({
            // hide host + credentials; just confirm there's a configured From.
            "from_configured": take("from").is_some(),
        }),
        notification::CHANNEL_NTFY => json!({
            // server URL is public, auth header is not
            "server_url": take("server_url"),
        }),
        notification::CHANNEL_WEBHOOK => json!({}),
        notification::CHANNEL_APPRISE => json!({
            "server_configured": take("server_url").is_some(),
        }),
        _ => json!({}),
    }
}

#[derive(Debug, Deserialize)]
struct UserChannelPatch {
    enabled: Option<bool>,
    destination: Option<Value>,
}

async fn patch_user_channel(
    State(state): State<AppState>,
    session: Session,
    Path(channel_type): Path<String>,
    Json(input): Json<UserChannelPatch>,
) -> AppResult<Json<notification::UserChannel>> {
    let user_id = auth::require_user(&session).await?;
    let row = notification::upsert_user_channel(
        &state.pool,
        user_id,
        &channel_type,
        input.enabled,
        input.destination,
    )
    .await?;
    Ok(Json(row))
}

// =============================================================================
// Per-event routing
// =============================================================================

#[derive(Debug, serde::Serialize)]
struct RoutesResponse {
    events: &'static [&'static str],
    channels: &'static [&'static str],
    routes: Vec<notification::UserRoute>,
}

async fn list_routes(
    State(state): State<AppState>,
    session: Session,
) -> AppResult<Json<RoutesResponse>> {
    let user_id = auth::require_user(&session).await?;
    let routes = notification::list_user_routes(&state.pool, user_id).await?;
    Ok(Json(RoutesResponse {
        events: notification::ALL_EVENTS,
        channels: notification::EXTERNAL_CHANNELS,
        routes,
    }))
}

#[derive(Debug, Deserialize)]
struct RoutesUpdate {
    updates: Vec<notification::RouteUpdate>,
}

async fn put_routes(
    State(state): State<AppState>,
    session: Session,
    Json(input): Json<RoutesUpdate>,
) -> AppResult<StatusCode> {
    let user_id = auth::require_user(&session).await?;
    notification::upsert_user_routes(&state.pool, user_id, &input.updates).await?;
    Ok(StatusCode::NO_CONTENT)
}

// =============================================================================
// Admin: system-level channel configuration
// =============================================================================

async fn admin_list_channels(
    State(state): State<AppState>,
    session: Session,
) -> AppResult<Json<Vec<notification::ChannelConfig>>> {
    auth::require_admin(&session, &state.pool).await?;
    Ok(Json(notification::list_channels(&state.pool).await?))
}

#[derive(Debug, Deserialize)]
struct AdminChannelPatch {
    enabled: Option<bool>,
    config: Option<Value>,
}

async fn admin_patch_channel(
    State(state): State<AppState>,
    session: Session,
    Path(channel_type): Path<String>,
    Json(input): Json<AdminChannelPatch>,
) -> AppResult<Json<notification::ChannelConfig>> {
    auth::require_admin(&session, &state.pool).await?;
    let row = notification::update_channel(
        &state.pool,
        &channel_type,
        input.enabled,
        input.config,
    )
    .await?;
    Ok(Json(row))
}

// =============================================================================
// Router
// =============================================================================

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/me/notification-channels",
            get(list_user_channels),
        )
        .route(
            "/me/notification-channels/{channel_type}",
            patch_method(patch_user_channel),
        )
        .route("/me/notification-routes", get(list_routes).put(put_routes))
        .route(
            "/admin/notification-channels",
            get(admin_list_channels),
        )
        .route(
            "/admin/notification-channels/{channel_type}",
            patch_method(admin_patch_channel),
        )
}

//! `/api/me/web-push/*` — Web Push subscription endpoints.
//!
//! The browser registers a service worker, calls
//! `pushManager.subscribe({applicationServerKey: <VAPID public key>})`,
//! and POSTs the resulting `PushSubscription` to us. We persist it as a
//! row in `web_push_subscriptions`.
//!
//! Each device gets its own row — a user can subscribe from multiple
//! browsers / phones and we'll fan out to all endpoints.

use crate::auth;
use crate::domain::notification;
use crate::error::AppResult;
use crate::state::AppState;
use axum::{
    Json, Router,
    extract::{Path, State},
    http::{HeaderMap, StatusCode, header::USER_AGENT},
    routing::{delete, get, post},
};
use serde::Deserialize;
use tower_sessions::Session;
use uuid::Uuid;

#[derive(Debug, Deserialize)]
struct SubscribeInput {
    endpoint: String,
    /// Base64-URL-encoded public key from the PushSubscription's `keys.p256dh`.
    p256dh: String,
    /// Base64-URL-encoded shared secret from the PushSubscription's `keys.auth`.
    auth: String,
}

async fn subscribe(
    State(state): State<AppState>,
    session: Session,
    headers: HeaderMap,
    Json(input): Json<SubscribeInput>,
) -> AppResult<(StatusCode, Json<notification::PushSubscription>)> {
    let user_id = auth::require_user(&session).await?;
    let ua = headers
        .get(USER_AGENT)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());
    let row = notification::register_push(
        &state.pool,
        user_id,
        &input.endpoint,
        &input.p256dh,
        &input.auth,
        ua.as_deref(),
    )
    .await?;
    Ok((StatusCode::CREATED, Json(row)))
}

async fn list(
    State(state): State<AppState>,
    session: Session,
) -> AppResult<Json<Vec<notification::PushSubscription>>> {
    let user_id = auth::require_user(&session).await?;
    Ok(Json(notification::list_push_subs(&state.pool, user_id).await?))
}

async fn unsubscribe_by_id(
    State(state): State<AppState>,
    session: Session,
    Path(id): Path<Uuid>,
) -> AppResult<StatusCode> {
    let user_id = auth::require_user(&session).await?;
    notification::delete_push(&state.pool, user_id, id).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Debug, Deserialize)]
struct UnsubByEndpoint {
    endpoint: String,
}

async fn unsubscribe_by_endpoint(
    State(state): State<AppState>,
    session: Session,
    Json(input): Json<UnsubByEndpoint>,
) -> AppResult<StatusCode> {
    let user_id = auth::require_user(&session).await?;
    notification::delete_push_by_endpoint(&state.pool, user_id, &input.endpoint).await?;
    Ok(StatusCode::NO_CONTENT)
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/me/web-push/subscribe", post(subscribe))
        .route("/me/web-push/unsubscribe", post(unsubscribe_by_endpoint))
        .route("/me/web-push/subscriptions", get(list))
        .route("/me/web-push/subscriptions/{id}", delete(unsubscribe_by_id))
}

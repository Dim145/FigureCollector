//! `/api/me/notifications` — the bell + the dedicated /notifications page.
//!
//! The external-channel surfaces (admin config, user destinations, web-push
//! subscriptions, per-event routes) live in sibling route modules to keep
//! this file focused on the read/mark-read flow that the bell consumes.

use crate::auth;
use crate::domain::notification;
use crate::error::AppResult;
use crate::state::AppState;
use axum::{
    Json, Router,
    extract::{Path, Query, State},
    http::StatusCode,
    routing::{delete, get, post},
};
use serde::Deserialize;
use tower_sessions::Session;
use uuid::Uuid;

#[derive(Debug, Deserialize)]
struct ListQuery {
    #[serde(default)]
    unread_only: bool,
    #[serde(default = "default_limit")]
    limit: i64,
    #[serde(default)]
    offset: i64,
}
fn default_limit() -> i64 {
    50
}

async fn list_mine(
    State(state): State<AppState>,
    session: Session,
    Query(q): Query<ListQuery>,
) -> AppResult<Json<Vec<notification::Notification>>> {
    let user_id = auth::require_user(&session).await?;
    Ok(Json(
        notification::list_for_user(&state.pool, user_id, q.unread_only, q.limit, q.offset)
            .await?,
    ))
}

async fn counts_mine(
    State(state): State<AppState>,
    session: Session,
) -> AppResult<Json<notification::CountsSummary>> {
    let user_id = auth::require_user(&session).await?;
    Ok(Json(notification::counts_for_user(&state.pool, user_id).await?))
}

async fn mark_one_read(
    State(state): State<AppState>,
    session: Session,
    Path(id): Path<Uuid>,
) -> AppResult<StatusCode> {
    let user_id = auth::require_user(&session).await?;
    notification::mark_read(&state.pool, user_id, id).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn mark_all_read(
    State(state): State<AppState>,
    session: Session,
) -> AppResult<Json<MarkAllResponse>> {
    let user_id = auth::require_user(&session).await?;
    let n = notification::mark_all_read(&state.pool, user_id).await?;
    Ok(Json(MarkAllResponse { affected: n }))
}

#[derive(serde::Serialize)]
struct MarkAllResponse {
    affected: u64,
}

async fn delete_one(
    State(state): State<AppState>,
    session: Session,
    Path(id): Path<Uuid>,
) -> AppResult<StatusCode> {
    let user_id = auth::require_user(&session).await?;
    notification::delete_one(&state.pool, user_id, id).await?;
    Ok(StatusCode::NO_CONTENT)
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/me/notifications", get(list_mine))
        .route("/me/notifications/counts", get(counts_mine))
        .route("/me/notifications/read-all", post(mark_all_read))
        .route("/me/notifications/{id}/read", post(mark_one_read))
        .route("/me/notifications/{id}", delete(delete_one))
}

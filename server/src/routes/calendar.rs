//! Pre-order calendar — a per-user iCal (.ics) subscription feed.
//!
//!   * `GET  /api/me/calendar`        — owner-only: the token + relative feed
//!                                      path (the SPA builds the absolute URL).
//!   * `POST /api/me/calendar/rotate` — owner-only: revoke + re-mint the token.
//!   * `GET  /api/calendar/{token}/preorders.ics` — PUBLIC: the feed itself,
//!                                      authorised solely by the unguessable
//!                                      token. A calendar app polls this URL.

use axum::{
    Json, Router,
    extract::{Path, State},
    http::header,
    response::IntoResponse,
    routing::{get, post},
};
use serde::Serialize;
use tower_sessions::Session;

use crate::auth::{self, user};
use crate::domain::calendar;
use crate::error::{AppError, AppResult};
use crate::state::AppState;

const ICS: &str = "text/calendar; charset=utf-8";

#[derive(Serialize)]
struct CalendarInfo {
    token: String,
    /// Relative path of the feed; the SPA prefixes its own origin (plus a
    /// `webcal://` variant) so the server needn't know the public host.
    feed_path: String,
}

fn feed_path(token: &str) -> String {
    format!("/api/calendar/{token}/preorders.ics")
}

fn info(token: String) -> Json<CalendarInfo> {
    Json(CalendarInfo {
        feed_path: feed_path(&token),
        token,
    })
}

async fn my_calendar(
    State(state): State<AppState>,
    session: Session,
) -> AppResult<Json<CalendarInfo>> {
    let uid = auth::require_user(&session).await?;
    Ok(info(calendar::ensure_calendar_token(&state.pool, uid).await?))
}

async fn rotate_calendar(
    State(state): State<AppState>,
    session: Session,
) -> AppResult<Json<CalendarInfo>> {
    let uid = auth::require_user(&session).await?;
    Ok(info(calendar::rotate_calendar_token(&state.pool, uid).await?))
}

async fn preorder_feed(
    State(state): State<AppState>,
    Path(token): Path<String>,
) -> AppResult<impl IntoResponse> {
    let owner = user::find_by_calendar_token(&state.pool, &token)
        .await?
        .ok_or(AppError::NotFound)?;
    let name = format!("FigureCollector · {}", owner.display_name);
    let body = calendar::preorders_ics(&state.pool, owner.id, &name).await?;
    Ok((
        [
            (header::CONTENT_TYPE, ICS.to_string()),
            (
                header::CONTENT_DISPOSITION,
                "inline; filename=\"preorders.ics\"".to_string(),
            ),
        ],
        body,
    ))
}

/// Owner-only token management — mounted in the authenticated `/api` tree.
pub fn router() -> Router<AppState> {
    Router::new()
        .route("/me/calendar", get(my_calendar))
        .route("/me/calendar/rotate", post(rotate_calendar))
}

/// The PUBLIC feed — the token is the only credential. Mounted with an IP-keyed
/// rate limiter (token probing / poll abuse) like the gift routes.
pub fn feed_router() -> Router<AppState> {
    Router::new().route("/calendar/{token}/preorders.ics", get(preorder_feed))
}

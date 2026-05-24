//! `/api/me/stats` — aggregate breakdowns for the signed-in user's collection.
//!
//! Single-shot endpoint so the StatsPage can render in one round-trip. The
//! payload is small (a handful of arrays, max 10 entries each).

use crate::auth;
use crate::domain::stats::{self, CollectionStats};
use crate::error::AppResult;
use crate::state::AppState;
use axum::{Json, Router, extract::State, routing::get};
use tower_sessions::Session;

async fn my_stats(
    State(state): State<AppState>,
    session: Session,
) -> AppResult<Json<CollectionStats>> {
    let user_id = auth::require_user(&session).await?;
    Ok(Json(stats::collection_stats(&state.pool, user_id).await?))
}

pub fn router() -> Router<AppState> {
    Router::new().route("/me/stats", get(my_stats))
}

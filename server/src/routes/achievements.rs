//! `/api/achievements`     — public catalog
//! `/api/me/achievements`  — what the signed-in user has unlocked

use crate::auth;
use crate::domain::achievement;
use crate::entity::achievements;
use crate::error::AppResult;
use crate::state::AppState;
use axum::{Json, Router, extract::State, routing::get};
use tower_sessions::Session;

async fn catalog(State(state): State<AppState>) -> AppResult<Json<Vec<achievements::Model>>> {
    Ok(Json(achievement::list_catalog(&state.db).await?))
}

async fn list_mine(
    State(state): State<AppState>,
    session: Session,
) -> AppResult<Json<Vec<achievement::UnlockedAchievement>>> {
    let user_id = auth::require_user(&session).await?;
    Ok(Json(achievement::list_for_user(&state.pool, user_id).await?))
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/achievements", get(catalog))
        .route("/me/achievements", get(list_mine))
}

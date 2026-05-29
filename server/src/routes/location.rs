//! `/api/me/locations` — the signed-in user's display cabinets ("vitrines").

use crate::auth;
use crate::domain::location::{self, LocationPatch, NewLocation};
use crate::error::AppResult;
use crate::state::AppState;
use axum::{
    Json, Router,
    extract::{Path, State},
    http::StatusCode,
    routing::{get, patch as patch_method},
};
use tower_sessions::Session;
use uuid::Uuid;

async fn list_mine(
    State(state): State<AppState>,
    session: Session,
) -> AppResult<Json<Vec<location::CollectionLocation>>> {
    let user_id = auth::require_user(&session).await?;
    Ok(Json(location::list(&state.pool, user_id).await?))
}

async fn create_mine(
    State(state): State<AppState>,
    session: Session,
    Json(input): Json<NewLocation>,
) -> AppResult<(StatusCode, Json<location::CollectionLocation>)> {
    let user_id = auth::require_user(&session).await?;
    let loc = location::create(&state.pool, user_id, input).await?;
    Ok((StatusCode::CREATED, Json(loc)))
}

async fn patch_mine(
    State(state): State<AppState>,
    session: Session,
    Path(id): Path<Uuid>,
    Json(input): Json<LocationPatch>,
) -> AppResult<Json<location::CollectionLocation>> {
    let user_id = auth::require_user(&session).await?;
    Ok(Json(location::patch(&state.pool, user_id, id, input).await?))
}

async fn delete_mine(
    State(state): State<AppState>,
    session: Session,
    Path(id): Path<Uuid>,
) -> AppResult<StatusCode> {
    let user_id = auth::require_user(&session).await?;
    location::delete(&state.pool, user_id, id).await?;
    Ok(StatusCode::NO_CONTENT)
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/me/locations", get(list_mine).post(create_mine))
        .route("/me/locations/{id}", patch_method(patch_mine).delete(delete_mine))
}

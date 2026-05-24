//! `/api/figures/*` — figurine catalog (manual entry today; scraping in Phase 2B).

use crate::auth;
use crate::domain::figure::{self, NewFigure};
use crate::error::AppResult;
use crate::state::AppState;
use axum::{
    Json, Router,
    extract::{Path, Query, State},
    http::StatusCode,
    routing::{get, post},
};
use tower_sessions::Session;
use uuid::Uuid;

async fn list(
    State(state): State<AppState>,
    Query(q): Query<figure::ListQuery>,
) -> AppResult<Json<Vec<figure::Figure>>> {
    Ok(Json(figure::list(&state.pool, q).await?))
}

async fn create(
    State(state): State<AppState>,
    session: Session,
    Json(input): Json<NewFigure>,
) -> AppResult<(StatusCode, Json<figure::Figure>)> {
    let user_id = auth::require_user(&session).await?;
    let figure = figure::create(&state.pool, user_id, input).await?;
    tracing::info!(figure_id = %figure.id, created_by = %user_id, "figure created");
    Ok((StatusCode::CREATED, Json(figure)))
}

async fn get_one(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> AppResult<Json<figure::Figure>> {
    let f = figure::find_by_id(&state.pool, id)
        .await?
        .ok_or(crate::error::AppError::NotFound)?;
    Ok(Json(f))
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/figures", get(list).post(create))
        .route("/figures/{id}", get(get_one))
}

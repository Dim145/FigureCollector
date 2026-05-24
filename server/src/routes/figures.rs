//! `/api/figures/*` — figurine catalog (manual entry today; scraping in Phase 2B).

use crate::auth;
use crate::domain::figure::{self, FigurePatch, NewFigure};
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use axum::{
    Json, Router,
    extract::{Path, Query, State},
    http::StatusCode,
    routing::get,
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
        .ok_or(AppError::NotFound)?;
    Ok(Json(f))
}

async fn patch_one(
    State(state): State<AppState>,
    session: Session,
    Path(id): Path<Uuid>,
    Json(input): Json<FigurePatch>,
) -> AppResult<Json<figure::Figure>> {
    let user = auth::require_user_full(&session, &state.pool).await?;
    let existing = figure::find_by_id(&state.pool, id)
        .await?
        .ok_or(AppError::NotFound)?;
    // Admins can edit anything; non-admins can only edit figures they created.
    let owner = existing.created_by == Some(user.id);
    if !user.is_admin && !owner {
        return Err(AppError::Forbidden);
    }
    let updated = figure::patch(&state.pool, id, input).await?;
    tracing::info!(
        figure_id = %updated.id,
        by_user = %user.id,
        as_admin = user.is_admin && !owner,
        "figure updated",
    );
    Ok(Json(updated))
}

async fn delete_one(
    State(state): State<AppState>,
    session: Session,
    Path(id): Path<Uuid>,
) -> AppResult<StatusCode> {
    let user = auth::require_user_full(&session, &state.pool).await?;
    let existing = figure::find_by_id(&state.pool, id)
        .await?
        .ok_or(AppError::NotFound)?;
    let owner = existing.created_by == Some(user.id);
    if !user.is_admin && !owner {
        return Err(AppError::Forbidden);
    }
    figure::delete(&state.pool, id).await?;
    tracing::info!(
        figure_id = %id,
        by_user = %user.id,
        as_admin = user.is_admin && !owner,
        "figure deleted",
    );
    Ok(StatusCode::NO_CONTENT)
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/figures", get(list).post(create))
        .route(
            "/figures/{id}",
            get(get_one)
                .patch(patch_one)
                .delete(delete_one),
        )
}

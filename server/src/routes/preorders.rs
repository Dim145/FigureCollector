//! `/api/me/preorders/*` — pre-orders with release-date slip history.

use crate::auth;
use crate::domain::preorder::{self, NewPreorder, PreorderPatch};
use crate::error::AppResult;
use crate::events::Event;
use crate::state::AppState;
use axum::{
    Json, Router,
    extract::{Path, State},
    http::StatusCode,
    routing::{delete, get, patch as patch_method},
};
use tower_sessions::Session;
use uuid::Uuid;

async fn list_mine(
    State(state): State<AppState>,
    session: Session,
) -> AppResult<Json<Vec<preorder::PreorderWithFigure>>> {
    let user_id = auth::require_user(&session).await?;
    Ok(Json(preorder::list_for_user(&state.pool, user_id).await?))
}

async fn add_mine(
    State(state): State<AppState>,
    session: Session,
    Json(input): Json<NewPreorder>,
) -> AppResult<(StatusCode, Json<preorder::Preorder>)> {
    let user_id = auth::require_user(&session).await?;
    let po = preorder::create(&state.pool, user_id, input).await?;
    state.events.publish(
        user_id,
        Event::PreorderCreated {
            preorder_id: po.id,
            figure_id: po.figure_id,
        },
    );
    Ok((StatusCode::CREATED, Json(po)))
}

async fn patch_mine(
    State(state): State<AppState>,
    session: Session,
    Path(id): Path<Uuid>,
    Json(input): Json<PreorderPatch>,
) -> AppResult<Json<preorder::Preorder>> {
    let user_id = auth::require_user(&session).await?;
    let updated = preorder::patch(&state.pool, user_id, id, input).await?;
    state
        .events
        .publish(user_id, Event::PreorderUpdated { preorder_id: id });
    Ok(Json(updated))
}

async fn delete_mine(
    State(state): State<AppState>,
    session: Session,
    Path(id): Path<Uuid>,
) -> AppResult<StatusCode> {
    let user_id = auth::require_user(&session).await?;
    preorder::delete_for_user(&state.pool, user_id, id).await?;
    state
        .events
        .publish(user_id, Event::PreorderDeleted { preorder_id: id });
    Ok(StatusCode::NO_CONTENT)
}

async fn history_mine(
    State(state): State<AppState>,
    session: Session,
    Path(id): Path<Uuid>,
) -> AppResult<Json<Vec<preorder::DateHistoryEntry>>> {
    let user_id = auth::require_user(&session).await?;
    Ok(Json(preorder::history(&state.pool, user_id, id).await?))
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/me/preorders", get(list_mine).post(add_mine))
        .route(
            "/me/preorders/{id}",
            patch_method(patch_mine).delete(delete_mine),
        )
        .route("/me/preorders/{id}/history", get(history_mine))
}

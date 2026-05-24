//! `/api/me/owned/*` — the signed-in user's physical collection.

use crate::auth;
use crate::domain::owned::{self, NewOwnedItem, OwnedPatch};
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
) -> AppResult<Json<Vec<owned::OwnedItemWithFigure>>> {
    let user_id = auth::require_user(&session).await?;
    Ok(Json(owned::list_for_user(&state.pool, user_id).await?))
}

async fn add_mine(
    State(state): State<AppState>,
    session: Session,
    Json(input): Json<NewOwnedItem>,
) -> AppResult<(StatusCode, Json<owned::OwnedItem>)> {
    let user_id = auth::require_user(&session).await?;
    let item = owned::create(&state.pool, user_id, input).await?;
    state.events.publish(
        user_id,
        Event::OwnedItemCreated {
            owned_id: item.id,
            figure_id: item.figure_id,
        },
    );
    tracing::info!(user_id = %user_id, figure_id = %item.figure_id, "owned_item added");
    Ok((StatusCode::CREATED, Json(item)))
}

async fn patch_mine(
    State(state): State<AppState>,
    session: Session,
    Path(id): Path<Uuid>,
    Json(input): Json<OwnedPatch>,
) -> AppResult<Json<owned::OwnedItem>> {
    let user_id = auth::require_user(&session).await?;
    let updated = owned::patch(&state.pool, user_id, id, input).await?;
    state
        .events
        .publish(user_id, Event::OwnedItemUpdated { owned_id: id });
    Ok(Json(updated))
}

async fn delete_mine(
    State(state): State<AppState>,
    session: Session,
    Path(id): Path<Uuid>,
) -> AppResult<StatusCode> {
    let user_id = auth::require_user(&session).await?;
    owned::delete_for_user(&state.pool, user_id, id).await?;
    state
        .events
        .publish(user_id, Event::OwnedItemDeleted { owned_id: id });
    Ok(StatusCode::NO_CONTENT)
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/me/owned", get(list_mine).post(add_mine))
        .route(
            "/me/owned/{id}",
            patch_method(patch_mine).delete(delete_mine),
        )
}

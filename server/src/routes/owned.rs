//! `/api/me/owned/*` — the signed-in user's physical collection.

use crate::auth;
use crate::domain::owned::{NewOwnedItem, OwnedPatch};
use crate::domain::{achievement, activity, owned};
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

    // Activity log: snapshot the figure so renames/deletes don't break the feed.
    let mut snap = activity::figure_snapshot(&state.pool, item.figure_id).await;
    if let Some(obj) = snap.as_object_mut() {
        obj.insert("condition".into(), serde_json::Value::String(item.condition.clone()));
        obj.insert("owned_id".into(), serde_json::Value::String(item.id.to_string()));
    }
    activity::record(&state.pool, user_id, "owned_added", snap).await;

    state.events.publish(
        user_id,
        Event::OwnedItemCreated {
            owned_id: item.id,
            figure_id: item.figure_id,
        },
    );
    tracing::info!(user_id = %user_id, figure_id = %item.figure_id, "owned_item added");

    // Phase 4B: re-evaluate the achievements rules.
    if let Ok(newly) = achievement::check_and_grant(&state.db, &state.pool, user_id).await {
        if !newly.is_empty() {
            state.events.publish(
                user_id,
                Event::AchievementsUnlocked {
                    codes: newly.iter().map(|a| a.code.clone()).collect(),
                },
            );
        }
    }

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

    // Snapshot before deletion so the activity payload still has context.
    let snapshot: Option<(Uuid, String, Option<String>)> = sqlx::query_as(
        "SELECT o.figure_id, f.name, m.name
         FROM owned_items o
         JOIN figures f         ON f.id = o.figure_id
         LEFT JOIN manufacturers m ON m.id = f.manufacturer_id
         WHERE o.id = $1 AND o.user_id = $2",
    )
    .bind(id)
    .bind(user_id)
    .fetch_optional(&state.pool)
    .await
    .ok()
    .flatten();

    owned::delete_for_user(&state.pool, user_id, id).await?;

    if let Some((figure_id, figure_name, manufacturer_name)) = snapshot {
        activity::record(
            &state.pool,
            user_id,
            "owned_removed",
            serde_json::json!({
                "owned_id": id,
                "figure_id": figure_id,
                "figure_name": figure_name,
                "manufacturer_name": manufacturer_name,
            }),
        )
        .await;
    }

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

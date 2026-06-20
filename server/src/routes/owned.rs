//! `/api/me/owned/*` — the signed-in user's physical collection.

use crate::auth;
use crate::domain::owned::{CoverPatch, NewOwnedItem, OwnedPatch};
use crate::domain::{achievement, activity, owned, preorder, shelf_layout};
use crate::error::AppResult;
use crate::events::Event;
use crate::state::AppState;
use axum::{
    Json, Router,
    extract::{Path, Query, State},
    http::StatusCode,
    routing::{get, patch as patch_method, post as post_method, put as put_method},
};
use serde::Deserialize;
use tower_sessions::Session;
use uuid::Uuid;

#[derive(Debug, Deserialize, Default)]
struct ListQuery {
    /// When `true`, archived items (e.g. cancelled preorders kept on file)
    /// are returned alongside the active collection. Default `false`.
    #[serde(default)]
    include_archived: bool,
}

async fn list_mine(
    State(state): State<AppState>,
    session: Session,
    Query(q): Query<ListQuery>,
) -> AppResult<Json<Vec<owned::OwnedItemWithFigure>>> {
    let user = auth::require_user_full(&session, &state.pool).await?;
    let exclude = user.nsfw_visibility == "hide";
    Ok(Json(
        owned::list_for_user(&state.pool, user.id, exclude, q.include_archived).await?,
    ))
}

async fn archive_mine(
    State(state): State<AppState>,
    session: Session,
    Path(id): Path<Uuid>,
) -> AppResult<Json<owned::OwnedItem>> {
    let user_id = auth::require_user(&session).await?;
    let updated = owned::archive(&state.pool, user_id, id).await?;
    state
        .events
        .publish(user_id, Event::OwnedItemUpdated { owned_id: id });
    Ok(Json(updated))
}

async fn restore_mine(
    State(state): State<AppState>,
    session: Session,
    Path(id): Path<Uuid>,
) -> AppResult<Json<owned::OwnedItem>> {
    let user_id = auth::require_user(&session).await?;
    let updated = owned::restore(&state.pool, user_id, id).await?;
    state
        .events
        .publish(user_id, Event::OwnedItemUpdated { owned_id: id });
    Ok(Json(updated))
}

async fn add_mine(
    State(state): State<AppState>,
    session: Session,
    Json(input): Json<NewOwnedItem>,
) -> AppResult<(StatusCode, Json<owned::OwnedItem>)> {
    let user_id = auth::require_user(&session).await?;
    // Freeze the cost→EUR rate at save time when a real price is recorded, so
    // the collection's plus-value doesn't drift with the market rate later.
    let price_fx_rate = match (&input.price_amount, input.price_currency.as_deref()) {
        (Some(_), Some(cur)) => {
            crate::external::fx::freeze_rate_to_eur(&state.pool, &state.http, cur).await
        }
        _ => None,
    };
    let item = owned::create(&state.pool, user_id, input, price_fx_rate).await?;
    state.cache.invalidate_user_collection(user_id).await;

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

    // Auto-link a preorder row when the figurine isn't out yet. Looks up the
    // catalog release_date directly to avoid trusting client-supplied input.
    let release: Option<(Option<chrono::NaiveDate>,)> =
        sqlx::query_as("SELECT release_date FROM figures WHERE id = $1")
            .bind(item.figure_id)
            .fetch_optional(&state.pool)
            .await?;
    if let Some((Some(date),)) = release {
        if date > chrono::Utc::now().date_naive() {
            match preorder::create_for_owned_item(
                &state.pool,
                user_id,
                item.id,
                item.figure_id,
                date,
            )
            .await
            {
                Ok(po) => {
                    tracing::info!(
                        preorder_id = %po.id, owned_id = %item.id, release = %date,
                        "auto-preorder created"
                    );
                    state.events.publish(
                        user_id,
                        Event::PreorderCreated {
                            preorder_id: po.id,
                            figure_id: item.figure_id,
                        },
                    );
                }
                Err(e) => {
                    tracing::warn!(error = ?e, owned_id = %item.id, "auto-preorder failed");
                }
            }
        }
    }

    // Phase 4B: re-evaluate the achievements rules.
    if let Ok(newly) =
        achievement::check_and_grant(&state.db, &state.pool, user_id, Some(item.figure_id)).await
    {
        if !newly.is_empty() {
            state.events.publish(
                user_id,
                Event::AchievementsUnlocked {
                    codes: newly.iter().map(|a| a.code.clone()).collect(),
                },
            );
            crate::services::notify::dispatch_achievements(&state, user_id, &newly).await;
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
    // Compute a fresh frozen rate for the patch's currency; the UPDATE only
    // adopts it when the currency actually changes (or was never captured), so
    // editing other fields never clobbers the purchase-time rate.
    let price_fx_rate = match input.price_currency.as_deref() {
        Some(cur) => crate::external::fx::freeze_rate_to_eur(&state.pool, &state.http, cur).await,
        None => None,
    };
    let updated = owned::patch(&state.pool, user_id, id, input, price_fx_rate).await?;
    state.cache.invalidate_user_collection(user_id).await;
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

    let orphaned = owned::delete_for_user(&state.pool, user_id, id).await?;
    state.cache.invalidate_user_collection(user_id).await;

    // Best-effort purge of the now-orphaned Garage blobs (the photo/scan rows
    // already cascaded away). Failures are logged inside the storage layer; a
    // missing key is a no-op on Garage.
    for key in &orphaned.photo_keys {
        if let Err(e) = state.storage.delete(key).await {
            tracing::warn!(error = ?e, storage_key = %key, "orphan photo blob delete failed after owned-item delete");
        }
    }
    for (prefix, result_key) in &orphaned.scan_blobs {
        crate::services::scan_cleanup::purge_scan_blobs(&state, prefix, result_key.as_deref()).await;
    }

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

async fn patch_cover(
    State(state): State<AppState>,
    session: Session,
    Path(id): Path<Uuid>,
    Json(input): Json<CoverPatch>,
) -> AppResult<Json<owned::OwnedItem>> {
    let user_id = auth::require_user(&session).await?;
    let updated = owned::set_cover(&state.pool, user_id, id, input).await?;
    state
        .events
        .publish(user_id, Event::OwnedItemUpdated { owned_id: id });
    Ok(Json(updated))
}

/// Body for `PUT /me/owned/{id}/value`. `amount: null` clears the manual
/// valuation, reverting the displayed cote to the catalog-MSRP fallback.
#[derive(Debug, Deserialize)]
struct SetValueBody {
    amount: Option<rust_decimal::Decimal>,
    currency: Option<String>,
}

async fn set_value_mine(
    State(state): State<AppState>,
    session: Session,
    Path(id): Path<Uuid>,
    Json(body): Json<SetValueBody>,
) -> AppResult<Json<owned::OwnedItem>> {
    let user_id = auth::require_user(&session).await?;
    let updated = owned::set_value(&state.pool, user_id, id, body.amount, body.currency).await?;
    state.cache.invalidate_user_collection(user_id).await;
    state
        .events
        .publish(user_id, Event::OwnedItemUpdated { owned_id: id });
    Ok(Json(updated))
}

/// Body for `PUT /me/owned/arrange` — re-home + re-order a cabinet's pieces in
/// one shot (Vitrines drag-and-drop). `location: ""` moves pieces to the
/// unshelved group; an OMITTED `location` reorders in place without touching
/// the shelf (a pure within-cabinet reorder).
#[derive(Debug, Deserialize)]
struct ArrangeBody {
    #[serde(default)]
    location: Option<String>,
    ordered_ids: Vec<Uuid>,
}

async fn arrange_mine(
    State(state): State<AppState>,
    session: Session,
    Json(body): Json<ArrangeBody>,
) -> AppResult<StatusCode> {
    let user_id = auth::require_user(&session).await?;
    owned::arrange(
        &state.pool,
        user_id,
        body.location.as_deref(),
        &body.ordered_ids,
    )
    .await?;
    Ok(StatusCode::NO_CONTENT)
}

// ── Free-form planner layout (Vitrines "atelier" view) ───────────────────────
// One opaque JSON document per user — absolute placements on the planner's
// shelves. Stored/returned verbatim; never feeds stats, so no cache invalidation.

async fn get_shelf_layout(
    State(state): State<AppState>,
    session: Session,
) -> AppResult<Json<serde_json::Value>> {
    let user_id = auth::require_user(&session).await?;
    Ok(Json(shelf_layout::get(&state.pool, user_id).await?))
}

async fn put_shelf_layout(
    State(state): State<AppState>,
    session: Session,
    Json(body): Json<serde_json::Value>,
) -> AppResult<StatusCode> {
    let user_id = auth::require_user(&session).await?;
    shelf_layout::put(&state.pool, user_id, body).await?;
    Ok(StatusCode::NO_CONTENT)
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/me/owned", get(list_mine).post(add_mine))
        .route(
            "/me/shelf-layout",
            get(get_shelf_layout).put(put_shelf_layout),
        )
        .route(
            "/me/owned/{id}",
            patch_method(patch_mine).delete(delete_mine),
        )
        .route("/me/owned/{id}/cover", patch_method(patch_cover))
        .route("/me/owned/{id}/value", put_method(set_value_mine))
        .route("/me/owned/arrange", put_method(arrange_mine))
        // Archive / restore for cancelled-preorder bookkeeping. Separate
        // verbs (not just a PATCH on `archived_at`) so the intent is
        // explicit and we can wire activity-feed entries later if needed.
        .route("/me/owned/{id}/archive", post_method(archive_mine))
        .route("/me/owned/{id}/restore", post_method(restore_mine))
}

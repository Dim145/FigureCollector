//! `/api/me/owned/*` — the signed-in user's physical collection.

use crate::auth;
use crate::domain::owned::{CoverPatch, NewOwnedItem, OwnedPatch};
use crate::domain::{owned, shelf_layout, tags};
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
    /// Appearance-tag facet: when set, return only owned items having at least
    /// one photo whose `visual_tags` contains this exact tag (case-insensitive).
    tag: Option<String>,
}

async fn list_mine(
    State(state): State<AppState>,
    session: Session,
    Query(q): Query<ListQuery>,
) -> AppResult<Json<Vec<owned::OwnedItemWithFigure>>> {
    let user = auth::require_user_full(&session, &state.pool).await?;
    let exclude = user.nsfw_visibility == "hide";
    Ok(Json(
        owned::list_for_user(
            &state.pool,
            user.id,
            exclude,
            q.include_archived,
            q.tag.as_deref(),
        )
        .await?,
    ))
}

/// Distinct appearance tags across the signed-in user's OWN photos, with
/// per-item counts (busiest first) — feeds the collection page's tag facet.
/// User-private (each user only sees their own photos' tags).
async fn list_my_photo_tags(
    State(state): State<AppState>,
    session: Session,
) -> AppResult<Json<Vec<tags::TagFacet>>> {
    let user_id = auth::require_user(&session).await?;
    Ok(Json(tags::owned_photo_facets(&state.pool, user_id, 80).await?))
}

/// Optional body for `POST /me/owned/{id}/archive`. `reason`
/// (sold|traded|lost|gifted|other) is captured on the row; the whole body is
/// optional so a bare archive (e.g. an auto-archive on partial-refund
/// cancellation) still works with no payload.
#[derive(Debug, Deserialize, Default)]
struct ArchiveBody {
    reason: Option<String>,
}

async fn archive_mine(
    State(state): State<AppState>,
    session: Session,
    Path(id): Path<Uuid>,
    body: Option<Json<ArchiveBody>>,
) -> AppResult<Json<owned::OwnedItem>> {
    let user_id = auth::require_user(&session).await?;
    let reason = body.and_then(|Json(b)| b.reason);
    Ok(Json(
        crate::services::collection::archive_owned_item(
            &state,
            user_id,
            id,
            reason.as_deref(),
        )
        .await?,
    ))
}

async fn restore_mine(
    State(state): State<AppState>,
    session: Session,
    Path(id): Path<Uuid>,
) -> AppResult<Json<owned::OwnedItem>> {
    let user_id = auth::require_user(&session).await?;
    Ok(Json(
        crate::services::collection::restore_owned_item(&state, user_id, id).await?,
    ))
}

async fn add_mine(
    State(state): State<AppState>,
    session: Session,
    Json(input): Json<NewOwnedItem>,
) -> AppResult<(StatusCode, Json<owned::OwnedItem>)> {
    let user_id = auth::require_user(&session).await?;
    let item = crate::services::collection::add_owned_item(&state, user_id, input).await?;
    Ok((StatusCode::CREATED, Json(item)))
}

async fn patch_mine(
    State(state): State<AppState>,
    session: Session,
    Path(id): Path<Uuid>,
    Json(input): Json<OwnedPatch>,
) -> AppResult<Json<owned::OwnedItem>> {
    let user_id = auth::require_user(&session).await?;
    Ok(Json(
        crate::services::collection::patch_owned_item(&state, user_id, id, input).await?,
    ))
}

async fn delete_mine(
    State(state): State<AppState>,
    session: Session,
    Path(id): Path<Uuid>,
) -> AppResult<StatusCode> {
    let user_id = auth::require_user(&session).await?;
    crate::services::collection::delete_owned_item(&state, user_id, id).await?;
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
    Ok(Json(
        crate::services::collection::set_owned_value(
            &state,
            user_id,
            id,
            body.amount,
            body.currency,
        )
        .await?,
    ))
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
        .route("/me/owned/tags", get(list_my_photo_tags))
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

//! `/api/admin/*` — staff-only endpoints, gated by `auth::require_admin`.

use crate::auth;
use crate::auth::user::User;
use crate::domain::admin::{self, NewAdminUser, UserPatch};
use crate::domain::entity::{self as ent, CharacterPatch, ManufacturerPatch, SeriesPatch};
use crate::domain::figure;
use crate::domain::figure_type::{self, FigureTypePatch, NewFigureType};
use crate::domain::store::{self, NewStore, StorePatch, StoreUsage};
use crate::domain::worker::{self, WorkerPatch, WorkerView};
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use axum::{
    Json, Router,
    extract::{Multipart, Path, Query, State},
    http::StatusCode,
    routing::{get, patch, post, put},
};
use serde::Deserialize;
use tower_sessions::Session;
use uuid::Uuid;

// ---------- /admin/overview --------------------------------------------------

async fn overview(
    State(state): State<AppState>,
    session: Session,
) -> AppResult<Json<admin::AdminOverview>> {
    auth::require_admin(&session, &state.pool).await?;
    Ok(Json(admin::overview(&state.pool).await?))
}

// ---------- /admin/users -----------------------------------------------------

async fn list_users(
    State(state): State<AppState>,
    session: Session,
) -> AppResult<Json<Vec<admin::AdminUserRow>>> {
    auth::require_admin(&session, &state.pool).await?;
    Ok(Json(admin::list_users(&state.pool).await?))
}

async fn create_user(
    State(state): State<AppState>,
    session: Session,
    Json(input): Json<NewAdminUser>,
) -> AppResult<(StatusCode, Json<User>)> {
    let actor = auth::require_admin(&session, &state.pool).await?;
    let user = admin::create_user(&state.pool, input).await?;
    tracing::info!(
        new_user = %user.id, by_admin = %actor.id, is_admin = user.is_admin,
        "admin created user",
    );
    Ok((StatusCode::CREATED, Json(user)))
}

async fn patch_user(
    State(state): State<AppState>,
    session: Session,
    Path(id): Path<Uuid>,
    Json(input): Json<UserPatch>,
) -> AppResult<Json<User>> {
    let actor = auth::require_admin(&session, &state.pool).await?;
    // Last-admin guard: refuse to demote the only remaining admin.
    if matches!(input.is_admin, Some(false)) {
        let overview = admin::overview(&state.pool).await?;
        let target_currently_admin =
            crate::auth::user::find_by_id(&state.pool, id).await?
                .is_some_and(|u| u.is_admin);
        if overview.admin_count <= 1 && target_currently_admin {
            return Err(AppError::BadRequest("cannot demote the last admin"));
        }
    }
    let user = admin::patch_user(&state.pool, id, input).await?;
    tracing::info!(target = %user.id, by_admin = %actor.id, "admin updated user");
    Ok(Json(user))
}

async fn delete_user(
    State(state): State<AppState>,
    session: Session,
    Path(id): Path<Uuid>,
) -> AppResult<StatusCode> {
    let actor = auth::require_admin(&session, &state.pool).await?;
    if actor.id == id {
        return Err(AppError::BadRequest("cannot delete your own account"));
    }
    // Refuse to wipe the last admin (would lock everyone out of /admin).
    let overview = admin::overview(&state.pool).await?;
    let target = crate::auth::user::find_by_id(&state.pool, id).await?;
    if let Some(t) = &target {
        if t.is_admin && overview.admin_count <= 1 {
            return Err(AppError::BadRequest("cannot delete the last admin"));
        }
    } else {
        return Err(AppError::NotFound);
    }
    admin::delete_user(&state.pool, id).await?;
    tracing::info!(target = %id, by_admin = %actor.id, "admin deleted user");
    Ok(StatusCode::NO_CONTENT)
}

// ---------- /admin/figures ---------------------------------------------------

#[derive(Deserialize)]
struct ListFiguresQuery {
    q: Option<String>,
    figure_type: Option<String>,
    manufacturer: Option<String>,
    limit: Option<i64>,
    offset: Option<i64>,
}

async fn list_figures(
    State(state): State<AppState>,
    session: Session,
    Query(q): Query<ListFiguresQuery>,
) -> AppResult<Json<Vec<figure::Figure>>> {
    auth::require_admin(&session, &state.pool).await?;
    // `figure::list` already returns the full catalog; admins just see more
    // because they aren't blocked by the user-creator visibility filter.
    let params = figure::ListQuery {
        q: q.q,
        figure_type: q.figure_type,
        manufacturer: q.manufacturer,
        limit: q.limit.or(Some(200)),
        offset: q.offset,
        // Admin moderation lists everything, regardless of viewer pref.
        exclude_nsfw: false,
    };
    Ok(Json(figure::list(&state.pool, params).await?))
}

// ============================================================================
// Entity admin — list + patch + photo upload for manufacturers / series /
// characters. Behind require_admin like everything else in this file.
// ============================================================================

const MAX_ENTITY_PHOTO_BYTES: usize = 5 * 1024 * 1024;
const MAX_ENTITY_PHOTO_DIM: u32 = 2048;

#[derive(Deserialize)]
struct EntityListQuery {
    q: Option<String>,
    limit: Option<i64>,
    offset: Option<i64>,
}

fn pagination(q: &EntityListQuery) -> (i64, i64) {
    let limit = q.limit.unwrap_or(100).clamp(1, 500);
    let offset = q.offset.unwrap_or(0).max(0);
    (limit, offset)
}

// ─── manufacturers ──────────────────────────────────────────────────────────

async fn list_manufacturers(
    State(state): State<AppState>,
    session: Session,
    Query(q): Query<EntityListQuery>,
) -> AppResult<Json<Vec<ent::Manufacturer>>> {
    auth::require_admin(&session, &state.pool).await?;
    let (limit, offset) = pagination(&q);
    Ok(Json(
        ent::list_manufacturers(&state.pool, q.q.as_deref(), limit, offset).await?,
    ))
}

async fn patch_manufacturer(
    State(state): State<AppState>,
    session: Session,
    Path(id): Path<Uuid>,
    Json(input): Json<ManufacturerPatch>,
) -> AppResult<Json<ent::Manufacturer>> {
    auth::require_admin(&session, &state.pool).await?;
    Ok(Json(ent::patch_manufacturer(&state.pool, id, input).await?))
}

async fn upload_manufacturer_photo(
    State(state): State<AppState>,
    session: Session,
    Path(id): Path<Uuid>,
    multipart: Multipart,
) -> AppResult<Json<ent::Manufacturer>> {
    auth::require_admin(&session, &state.pool).await?;
    let key = process_and_store(&state, "manufacturers", id, multipart).await?;
    let patch = ManufacturerPatch { image_key: Some(key), ..Default::default() };
    Ok(Json(ent::patch_manufacturer(&state.pool, id, patch).await?))
}

// ─── series ─────────────────────────────────────────────────────────────────

async fn list_series(
    State(state): State<AppState>,
    session: Session,
    Query(q): Query<EntityListQuery>,
) -> AppResult<Json<Vec<ent::Series>>> {
    auth::require_admin(&session, &state.pool).await?;
    let (limit, offset) = pagination(&q);
    Ok(Json(
        ent::list_series(&state.pool, q.q.as_deref(), limit, offset).await?,
    ))
}

async fn patch_series(
    State(state): State<AppState>,
    session: Session,
    Path(id): Path<Uuid>,
    Json(input): Json<SeriesPatch>,
) -> AppResult<Json<ent::Series>> {
    auth::require_admin(&session, &state.pool).await?;
    Ok(Json(ent::patch_series(&state.pool, id, input).await?))
}

async fn upload_series_photo(
    State(state): State<AppState>,
    session: Session,
    Path(id): Path<Uuid>,
    multipart: Multipart,
) -> AppResult<Json<ent::Series>> {
    auth::require_admin(&session, &state.pool).await?;
    let key = process_and_store(&state, "series", id, multipart).await?;
    let patch = SeriesPatch { image_key: Some(key), ..Default::default() };
    Ok(Json(ent::patch_series(&state.pool, id, patch).await?))
}

// ─── characters ─────────────────────────────────────────────────────────────

async fn list_characters(
    State(state): State<AppState>,
    session: Session,
    Query(q): Query<EntityListQuery>,
) -> AppResult<Json<Vec<ent::Character>>> {
    auth::require_admin(&session, &state.pool).await?;
    let (limit, offset) = pagination(&q);
    Ok(Json(
        ent::list_characters(&state.pool, q.q.as_deref(), limit, offset).await?,
    ))
}

async fn patch_character(
    State(state): State<AppState>,
    session: Session,
    Path(id): Path<Uuid>,
    Json(input): Json<CharacterPatch>,
) -> AppResult<Json<ent::Character>> {
    auth::require_admin(&session, &state.pool).await?;
    Ok(Json(ent::patch_character(&state.pool, id, input).await?))
}

async fn upload_character_photo(
    State(state): State<AppState>,
    session: Session,
    Path(id): Path<Uuid>,
    multipart: Multipart,
) -> AppResult<Json<ent::Character>> {
    auth::require_admin(&session, &state.pool).await?;
    let key = process_and_store(&state, "characters", id, multipart).await?;
    let patch = CharacterPatch { image_key: Some(key), ..Default::default() };
    Ok(Json(ent::patch_character(&state.pool, id, patch).await?))
}

// ─── bulk link/unlink/move + delete (series & characters) ───────────────────
//
// Common payload shapes:
//   POST .../unlink  → { figure_ids: [Uuid, ...] }
//   POST .../move    → { figure_ids: [Uuid, ...], to_id: Uuid }
//   DELETE           → ?replacement_id=Uuid (optional)
//
// The "move" endpoint also doubles as a "merge into" preview when the admin
// selects every figure of the source — but explicit `delete?replacement_id`
// stays the canonical way to wipe a series.

#[derive(Deserialize)]
struct BulkFigureIds {
    figure_ids: Vec<Uuid>,
}

#[derive(Deserialize)]
struct MoveFiguresInput {
    figure_ids: Vec<Uuid>,
    to_id: Uuid,
}

#[derive(Deserialize)]
struct DeleteWithReplacement {
    replacement_id: Option<Uuid>,
}

#[derive(serde::Serialize)]
struct AffectedRows {
    affected: u64,
}

async fn unlink_series_figures(
    State(state): State<AppState>,
    session: Session,
    Path(series_id): Path<Uuid>,
    Json(input): Json<BulkFigureIds>,
) -> AppResult<Json<AffectedRows>> {
    auth::require_admin(&session, &state.pool).await?;
    let n =
        ent::unlink_figures_from_series(&state.pool, series_id, &input.figure_ids).await?;
    Ok(Json(AffectedRows { affected: n }))
}

async fn move_series_figures(
    State(state): State<AppState>,
    session: Session,
    Path(from_series): Path<Uuid>,
    Json(input): Json<MoveFiguresInput>,
) -> AppResult<Json<AffectedRows>> {
    auth::require_admin(&session, &state.pool).await?;
    let n = ent::move_figures_between_series(
        &state.pool,
        from_series,
        input.to_id,
        &input.figure_ids,
    )
    .await?;
    Ok(Json(AffectedRows { affected: n }))
}

async fn delete_series(
    State(state): State<AppState>,
    session: Session,
    Path(id): Path<Uuid>,
    Query(q): Query<DeleteWithReplacement>,
) -> AppResult<StatusCode> {
    let actor = auth::require_admin(&session, &state.pool).await?;
    ent::delete_series(&state.pool, id, q.replacement_id).await?;
    tracing::info!(
        series = %id, replacement = ?q.replacement_id, by_admin = %actor.id,
        "admin deleted series",
    );
    Ok(StatusCode::NO_CONTENT)
}

async fn unlink_character_figures(
    State(state): State<AppState>,
    session: Session,
    Path(character_id): Path<Uuid>,
    Json(input): Json<BulkFigureIds>,
) -> AppResult<Json<AffectedRows>> {
    auth::require_admin(&session, &state.pool).await?;
    let n = ent::unlink_figures_from_character(&state.pool, character_id, &input.figure_ids)
        .await?;
    Ok(Json(AffectedRows { affected: n }))
}

async fn move_character_figures(
    State(state): State<AppState>,
    session: Session,
    Path(from_character): Path<Uuid>,
    Json(input): Json<MoveFiguresInput>,
) -> AppResult<Json<AffectedRows>> {
    auth::require_admin(&session, &state.pool).await?;
    let n = ent::move_figures_between_characters(
        &state.pool,
        from_character,
        input.to_id,
        &input.figure_ids,
    )
    .await?;
    Ok(Json(AffectedRows { affected: n }))
}

async fn delete_character(
    State(state): State<AppState>,
    session: Session,
    Path(id): Path<Uuid>,
    Query(q): Query<DeleteWithReplacement>,
) -> AppResult<StatusCode> {
    let actor = auth::require_admin(&session, &state.pool).await?;
    ent::delete_character(&state.pool, id, q.replacement_id).await?;
    tracing::info!(
        character = %id, replacement = ?q.replacement_id, by_admin = %actor.id,
        "admin deleted character",
    );
    Ok(StatusCode::NO_CONTENT)
}

// ─── shared photo pipeline ──────────────────────────────────────────────────

/// Read a single `file` multipart field, validate format + size, re-encode
/// to WebP (strips EXIF), upload to Garage at `entities/{kind}/{id}/{uuid}.webp`,
/// return the storage key.
async fn process_and_store(
    state: &AppState,
    kind: &'static str,
    id: Uuid,
    mut multipart: Multipart,
) -> AppResult<String> {
    let mut bytes: Option<Vec<u8>> = None;
    while let Some(field) = multipart.next_field().await.map_err(|e| {
        AppError::BadRequest(Box::leak(format!("multipart error: {e}").into_boxed_str()))
    })? {
        if field.name() == Some("file") {
            let data = field
                .bytes()
                .await
                .map_err(|_| AppError::BadRequest("could not read upload body"))?;
            if data.len() > MAX_ENTITY_PHOTO_BYTES {
                return Err(AppError::BadRequest("photo too large (max 5 MB)"));
            }
            bytes = Some(data.to_vec());
            break;
        }
    }
    let raw = bytes.ok_or(AppError::BadRequest("missing 'file' multipart field"))?;

    // Shared pipeline: format whitelist + dimension cap + EXIF-stripping
    // WebP re-encode, off the runtime worker via `spawn_blocking`.
    let (cleaned, _w, _h) =
        crate::photo::sanitize_to_webp(raw, MAX_ENTITY_PHOTO_DIM).await?;

    let key = format!("entities/{kind}/{id}/{}.webp", Uuid::now_v7());
    state.storage.put(&key, &cleaned, "image/webp").await?;
    Ok(key)
}

// ---------- /admin/stores — CRUD + usage + image upload --------------------

async fn list_stores_admin(
    State(state): State<AppState>,
    session: Session,
) -> AppResult<Json<Vec<store::Store>>> {
    auth::require_admin(&session, &state.pool).await?;
    Ok(Json(store::list(&state.pool).await?))
}

async fn create_store(
    State(state): State<AppState>,
    session: Session,
    Json(input): Json<NewStore>,
) -> AppResult<(StatusCode, Json<store::Store>)> {
    auth::require_admin(&session, &state.pool).await?;
    let row = store::create(&state.pool, input).await?;
    Ok((StatusCode::CREATED, Json(row)))
}

async fn patch_store(
    State(state): State<AppState>,
    session: Session,
    Path(id): Path<Uuid>,
    Json(input): Json<StorePatch>,
) -> AppResult<Json<store::Store>> {
    auth::require_admin(&session, &state.pool).await?;
    Ok(Json(store::patch(&state.pool, id, input).await?))
}

async fn delete_store(
    State(state): State<AppState>,
    session: Session,
    Path(id): Path<Uuid>,
) -> AppResult<StatusCode> {
    auth::require_admin(&session, &state.pool).await?;
    store::delete(&state.pool, id).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn store_usage(
    State(state): State<AppState>,
    session: Session,
    Path(id): Path<Uuid>,
) -> AppResult<Json<StoreUsage>> {
    auth::require_admin(&session, &state.pool).await?;
    Ok(Json(store::usage(&state.pool, id).await?))
}

async fn upload_store_photo(
    State(state): State<AppState>,
    session: Session,
    Path(id): Path<Uuid>,
    multipart: Multipart,
) -> AppResult<Json<store::Store>> {
    auth::require_admin(&session, &state.pool).await?;
    let key = process_and_store(&state, "stores", id, multipart).await?;
    Ok(Json(store::set_image_key(&state.pool, id, &key).await?))
}

// ---------- /admin/stores/{id}/figures — link admin ---------------------------

#[derive(serde::Deserialize)]
struct BulkFiguresInput {
    figure_ids: Vec<Uuid>,
}

/// PUT — bulk replace the full list of figures linked to a store. Used by
/// the StorePage admin checkbox grid. Sent as one transactional diff so
/// partial saves never leave the catalog in a torn state.
async fn set_store_figures(
    State(state): State<AppState>,
    session: Session,
    Path(id): Path<Uuid>,
    Json(input): Json<BulkFiguresInput>,
) -> AppResult<StatusCode> {
    auth::require_admin(&session, &state.pool).await?;
    store::set_store_figures(&state.pool, id, &input.figure_ids).await?;
    Ok(StatusCode::NO_CONTENT)
}

/// POST — add one figure to a store (idempotent via ON CONFLICT). Used
/// from the FigureForm admin section.
async fn add_figure_to_store(
    State(state): State<AppState>,
    session: Session,
    Path((store_id, figure_id)): Path<(Uuid, Uuid)>,
) -> AppResult<StatusCode> {
    auth::require_admin(&session, &state.pool).await?;
    store::link_figure(&state.pool, store_id, figure_id).await?;
    Ok(StatusCode::NO_CONTENT)
}

/// DELETE — remove one figure from a store. Note that the
/// `owned_items_sync_store` / `preorders_sync_store` triggers will re-add
/// the link on the next write of a matching owned_item or preorder; the
/// admin's removal only sticks until then.
async fn remove_figure_from_store(
    State(state): State<AppState>,
    session: Session,
    Path((store_id, figure_id)): Path<(Uuid, Uuid)>,
) -> AppResult<StatusCode> {
    auth::require_admin(&session, &state.pool).await?;
    store::unlink_figure(&state.pool, store_id, figure_id).await?;
    Ok(StatusCode::NO_CONTENT)
}

// ---------- /admin/figure-types — CRUD --------------------------------------

async fn list_figure_types_admin(
    State(state): State<AppState>,
    session: tower_sessions::Session,
) -> AppResult<Json<Vec<figure_type::FigureType>>> {
    auth::require_admin(&session, &state.pool).await?;
    Ok(Json(figure_type::list(&state.pool).await?))
}

async fn create_figure_type(
    State(state): State<AppState>,
    session: tower_sessions::Session,
    Json(input): Json<NewFigureType>,
) -> AppResult<(StatusCode, Json<figure_type::FigureType>)> {
    auth::require_admin(&session, &state.pool).await?;
    let row = figure_type::create(&state.pool, input).await?;
    Ok((StatusCode::CREATED, Json(row)))
}

async fn patch_figure_type(
    State(state): State<AppState>,
    session: tower_sessions::Session,
    Path(id): Path<String>,
    Json(input): Json<FigureTypePatch>,
) -> AppResult<Json<figure_type::FigureType>> {
    auth::require_admin(&session, &state.pool).await?;
    Ok(Json(figure_type::patch(&state.pool, &id, input).await?))
}

async fn delete_figure_type(
    State(state): State<AppState>,
    session: tower_sessions::Session,
    Path(id): Path<String>,
) -> AppResult<StatusCode> {
    auth::require_admin(&session, &state.pool).await?;
    figure_type::delete(&state.pool, &id).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(serde::Serialize)]
struct FigureTypeUsage {
    id: String,
    count: i64,
}

async fn figure_type_usage(
    State(state): State<AppState>,
    session: tower_sessions::Session,
    Path(id): Path<String>,
) -> AppResult<Json<FigureTypeUsage>> {
    auth::require_admin(&session, &state.pool).await?;
    let count = figure_type::usage_count(&state.pool, &id).await?;
    Ok(Json(FigureTypeUsage { id, count }))
}

// ---------- /admin/workers — list / toggle / rename / delete --------------

async fn list_workers(
    State(state): State<AppState>,
    session: Session,
) -> AppResult<Json<Vec<WorkerView>>> {
    auth::require_admin(&session, &state.pool).await?;
    Ok(Json(worker::list(&state.pool).await?))
}

async fn patch_worker(
    State(state): State<AppState>,
    session: Session,
    Path(id): Path<Uuid>,
    Json(input): Json<WorkerPatch>,
) -> AppResult<Json<WorkerView>> {
    let actor = auth::require_admin(&session, &state.pool).await?;
    let row = worker::patch(&state.pool, id, input).await?;
    tracing::info!(worker = %row.worker.id, by_admin = %actor.id, "admin updated worker");
    Ok(Json(row))
}

async fn delete_worker(
    State(state): State<AppState>,
    session: Session,
    Path(id): Path<Uuid>,
) -> AppResult<StatusCode> {
    let actor = auth::require_admin(&session, &state.pool).await?;
    worker::delete(&state.pool, id).await?;
    tracing::info!(worker = %id, by_admin = %actor.id, "admin deleted worker");
    Ok(StatusCode::NO_CONTENT)
}

// =============================================================================
// Bulk operations (Lot 6) — best-effort multi-row delete. Each item reuses the
// single-row domain delete so per-item guards / cascades still apply; a failed
// row counts as skipped rather than aborting the whole batch.
// =============================================================================

#[derive(Deserialize)]
struct BulkIds {
    ids: Vec<Uuid>,
}

#[derive(Deserialize)]
struct BulkStrIds {
    ids: Vec<String>,
}

#[derive(serde::Serialize)]
struct BulkResult {
    deleted: i64,
    skipped: i64,
}

async fn bulk_delete_figures(
    State(state): State<AppState>,
    session: Session,
    Json(b): Json<BulkIds>,
) -> AppResult<Json<BulkResult>> {
    auth::require_admin(&session, &state.pool).await?;
    let (mut deleted, mut skipped) = (0, 0);
    for id in b.ids {
        if figure::delete(&state.pool, id).await.is_ok() {
            deleted += 1;
        } else {
            skipped += 1;
        }
    }
    tracing::info!(deleted, skipped, "admin bulk-deleted figures");
    Ok(Json(BulkResult { deleted, skipped }))
}

async fn bulk_delete_stores(
    State(state): State<AppState>,
    session: Session,
    Json(b): Json<BulkIds>,
) -> AppResult<Json<BulkResult>> {
    auth::require_admin(&session, &state.pool).await?;
    let (mut deleted, mut skipped) = (0, 0);
    for id in b.ids {
        if store::delete(&state.pool, id).await.is_ok() {
            deleted += 1;
        } else {
            skipped += 1;
        }
    }
    Ok(Json(BulkResult { deleted, skipped }))
}

async fn bulk_delete_figure_types(
    State(state): State<AppState>,
    session: Session,
    Json(b): Json<BulkStrIds>,
) -> AppResult<Json<BulkResult>> {
    auth::require_admin(&session, &state.pool).await?;
    let (mut deleted, mut skipped) = (0, 0);
    for id in b.ids {
        if figure_type::delete(&state.pool, &id).await.is_ok() {
            deleted += 1;
        } else {
            skipped += 1;
        }
    }
    Ok(Json(BulkResult { deleted, skipped }))
}

async fn bulk_delete_users(
    State(state): State<AppState>,
    session: Session,
    Json(b): Json<BulkIds>,
) -> AppResult<Json<BulkResult>> {
    let actor = auth::require_admin(&session, &state.pool).await?;
    let (mut deleted, mut skipped) = (0, 0);
    for id in b.ids {
        // Never bulk-delete yourself or any admin — admins go one at a time.
        if id == actor.id {
            skipped += 1;
            continue;
        }
        match crate::auth::user::find_by_id(&state.pool, id).await {
            Ok(Some(u)) if !u.is_admin && admin::delete_user(&state.pool, id).await.is_ok() => {
                deleted += 1;
            }
            _ => skipped += 1,
        }
    }
    tracing::info!(deleted, skipped, by_admin = %actor.id, "admin bulk-deleted users");
    Ok(Json(BulkResult { deleted, skipped }))
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/admin/overview", get(overview))
        .route("/admin/users", get(list_users).post(create_user))
        .route(
            "/admin/users/{id}",
            axum::routing::patch(patch_user).delete(delete_user),
        )
        .route("/admin/figures", get(list_figures))
        .route("/admin/figures/bulk-delete", post(bulk_delete_figures))
        .route("/admin/users/bulk-delete", post(bulk_delete_users))
        .route("/admin/figure-types/bulk-delete", post(bulk_delete_figure_types))
        .route("/admin/stores/bulk-delete", post(bulk_delete_stores))
        // ─── catalog entities — JSON CRUD ────────────────────────────────
        .route("/admin/manufacturers", get(list_manufacturers))
        .route("/admin/manufacturers/{id}", patch(patch_manufacturer))
        .route("/admin/series", get(list_series))
        .route(
            "/admin/series/{id}",
            patch(patch_series).delete(delete_series),
        )
        .route("/admin/series/{id}/figures/unlink", post(unlink_series_figures))
        .route("/admin/series/{id}/figures/move", post(move_series_figures))
        .route("/admin/characters", get(list_characters))
        .route(
            "/admin/characters/{id}",
            patch(patch_character).delete(delete_character),
        )
        .route(
            "/admin/characters/{id}/figures/unlink",
            post(unlink_character_figures),
        )
        .route(
            "/admin/characters/{id}/figures/move",
            post(move_character_figures),
        )
        // ─── figure types — admin curates the dropdown values ────────────
        .route(
            "/admin/figure-types",
            get(list_figure_types_admin).post(create_figure_type),
        )
        .route(
            "/admin/figure-types/{id}",
            patch(patch_figure_type).delete(delete_figure_type),
        )
        .route("/admin/figure-types/{id}/usage", get(figure_type_usage))
        // ─── stores — admin CRUD + usage ─────────────────────────────────
        .route(
            "/admin/stores",
            get(list_stores_admin).post(create_store),
        )
        .route(
            "/admin/stores/{id}",
            patch(patch_store).delete(delete_store),
        )
        .route("/admin/stores/{id}/usage", get(store_usage))
        .route("/admin/stores/{id}/figures", put(set_store_figures))
        .route(
            "/admin/stores/{store_id}/figures/{figure_id}",
            post(add_figure_to_store).delete(remove_figure_from_store),
        )
        // ─── workers — gsplat compute registry (one row per CUDA / Metal) ───
        .route("/admin/workers", get(list_workers))
        .route(
            "/admin/workers/{id}",
            patch(patch_worker).delete(delete_worker),
        )
}

/// Photo upload routes for catalog entities. Split out so `routes::mod` can
/// apply the multipart body-limit layer (DefaultBodyLimit + RequestBodyLimit)
/// without affecting the JSON-only admin handlers.
pub fn photo_upload_router() -> Router<AppState> {
    Router::new()
        .route(
            "/admin/manufacturers/{id}/photo",
            post(upload_manufacturer_photo),
        )
        .route("/admin/series/{id}/photo", post(upload_series_photo))
        .route("/admin/stores/{id}/photo", post(upload_store_photo))
        .route(
            "/admin/characters/{id}/photo",
            post(upload_character_photo),
        )
}

//! `/api/admin/*` — staff-only endpoints, gated by `auth::require_admin`.

use crate::auth;
use crate::auth::user::User;
use crate::domain::admin::{self, NewAdminUser, UserPatch};
use crate::domain::entity::{self as ent, CharacterPatch, ManufacturerPatch, SeriesPatch};
use crate::domain::figure;
use crate::domain::figure_type::{self, FigureTypePatch, NewFigureType};
use crate::domain::manga_servers::{self, MangaServer, MangaServerAdmin};
use crate::domain::notification;
use crate::domain::ocr_job::{self, AdminOcrJob};
use crate::domain::scan::{self, AdminScan};
use crate::domain::server_job;
use crate::domain::service_health::{self, ServiceHealth};
use crate::domain::settings;
use crate::domain::store::{self, NewStore, StorePatch, StoreUsage};
use crate::domain::visual_search;
use crate::domain::worker::{self, WorkerPatch, WorkerView};
use crate::error::{AppError, AppResult};
use crate::services::notify;
use crate::state::AppState;
use axum::{
    Json, Router,
    extract::{Multipart, Path, Query, State},
    http::StatusCode,
    routing::{get, patch, post, put},
};
use serde::Deserialize;
use serde_json::json;
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
        tag: None,
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
        tracing::warn!(error = %e, "multipart framing error");
        AppError::BadRequest("malformed multipart request")
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

/// Body for linking one figure to a store. `link` is the product page — a full
/// URL or a bare `/path?query`; the server keeps only the path+query (the host
/// lives on `stores.url`). Absent / null / empty clears any existing link.
#[derive(serde::Deserialize, Default)]
struct LinkFigureInput {
    #[serde(default)]
    link: Option<String>,
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

/// POST — add one figure to a store, or set/clear its buy link (idempotent
/// upsert). Used from the FigureForm admin section. The optional `link` in the
/// body is normalised to a path+query before storage.
async fn add_figure_to_store(
    State(state): State<AppState>,
    session: Session,
    Path((store_id, figure_id)): Path<(Uuid, Uuid)>,
    Json(input): Json<LinkFigureInput>,
) -> AppResult<StatusCode> {
    auth::require_admin(&session, &state.pool).await?;
    store::link_figure(&state.pool, store_id, figure_id, input.link.as_deref()).await?;
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
        match figure::delete(&state.pool, id).await {
            Ok(storage_keys) => {
                deleted += 1;
                // Photo blobs don't cascade with the row — drop them so they
                // don't leak in Garage.
                for key in &storage_keys {
                    if let Err(e) = state.storage.delete(key).await {
                        tracing::warn!(error = ?e, storage_key = %key, "failed to delete figure photo blob on bulk delete");
                    }
                }
            }
            Err(_) => skipped += 1,
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

// ---------- /admin/manga-servers — MangaCollector allow-list ----------------
//
// Users submit servers (→ pending); admins approve / revoke / relabel / delete.
// Approving or revoking notifies every user currently linked to that server via
// the in-app + real-time notification pipeline (`services::notify`).

async fn list_manga_servers(
    State(state): State<AppState>,
    session: Session,
) -> AppResult<Json<Vec<MangaServerAdmin>>> {
    auth::require_admin(&session, &state.pool).await?;
    Ok(Json(manga_servers::list_all_admin(&state.pool).await?))
}

async fn approve_manga_server(
    State(state): State<AppState>,
    session: Session,
    Path(id): Path<Uuid>,
) -> AppResult<Json<MangaServer>> {
    let actor = auth::require_admin(&session, &state.pool).await?;
    let server = manga_servers::approve(&state.pool, id, actor.id).await?;
    // Linked users were waiting on this — tell them it's live now.
    for uid in manga_servers::linked_user_ids(&state.pool, id).await? {
        notify::dispatch(
            &state,
            uid,
            notification::EVENT_MANGA_SERVER_APPROVED,
            json!({ "base_url": server.base_url, "label": server.label }),
            None,
        )
        .await;
    }
    tracing::info!(server = %id, by_admin = %actor.id, "admin approved manga server");
    Ok(Json(server))
}

#[derive(Deserialize)]
struct RevokeServerBody {
    #[serde(default)]
    note: Option<String>,
}

async fn revoke_manga_server(
    State(state): State<AppState>,
    session: Session,
    Path(id): Path<Uuid>,
    Json(body): Json<RevokeServerBody>,
) -> AppResult<Json<MangaServer>> {
    let actor = auth::require_admin(&session, &state.pool).await?;
    let (server, affected) =
        manga_servers::revoke(&state.pool, id, actor.id, body.note.as_deref()).await?;
    // Notify everyone whose link just went dormant; the reason rides along.
    for uid in affected {
        notify::dispatch(
            &state,
            uid,
            notification::EVENT_MANGA_SERVER_REVOKED,
            json!({ "base_url": server.base_url, "label": server.label, "reason": server.note }),
            None,
        )
        .await;
    }
    tracing::info!(server = %id, by_admin = %actor.id, "admin revoked manga server");
    Ok(Json(server))
}

#[derive(Deserialize)]
struct LabelServerBody {
    #[serde(default)]
    label: Option<String>,
}

async fn patch_manga_server(
    State(state): State<AppState>,
    session: Session,
    Path(id): Path<Uuid>,
    Json(body): Json<LabelServerBody>,
) -> AppResult<Json<MangaServer>> {
    auth::require_admin(&session, &state.pool).await?;
    Ok(Json(
        manga_servers::set_label(&state.pool, id, body.label.as_deref()).await?,
    ))
}

async fn delete_manga_server(
    State(state): State<AppState>,
    session: Session,
    Path(id): Path<Uuid>,
) -> AppResult<StatusCode> {
    let actor = auth::require_admin(&session, &state.pool).await?;
    manga_servers::delete(&state.pool, id).await?;
    tracing::info!(server = %id, by_admin = %actor.id, "admin deleted manga server");
    Ok(StatusCode::NO_CONTENT)
}

// ---------- /admin/scans — gsplat task queue --------------------------------
//
// The scans table is already a Postgres queue; these surface it to admins +
// expose retry / force-fail / delete. All scoped to kind='gsplat' in the domain.

async fn list_scans_admin(
    State(state): State<AppState>,
    session: Session,
) -> AppResult<Json<Vec<AdminScan>>> {
    auth::require_admin(&session, &state.pool).await?;
    Ok(Json(scan::admin_list(&state.pool, 200).await?))
}

// ---------- /admin/ocr-jobs — invoice-OCR task queue ------------------------
//
// The `document_ocr_jobs` table is a Postgres queue drained by the GPU worker
// (RapidOCR). Read-only mirror of the scan queue above so the Tasks console can
// show OCR jobs next to gsplat scans.

async fn list_ocr_jobs_admin(
    State(state): State<AppState>,
    session: Session,
) -> AppResult<Json<Vec<AdminOcrJob>>> {
    auth::require_admin(&session, &state.pool).await?;
    Ok(Json(ocr_job::admin_list(&state.pool, 200).await?))
}

/// Delete an OCR job row (any state). The GPU worker owns the row's lifecycle,
/// but an admin may drop a wedged/stale job; a later worker write-back just
/// UPDATEs 0 rows. 204 even if the id was already gone.
async fn delete_ocr_job_admin(
    State(state): State<AppState>,
    session: Session,
    Path(id): Path<Uuid>,
) -> AppResult<StatusCode> {
    let actor = auth::require_admin(&session, &state.pool).await?;
    ocr_job::delete(&state.pool, id).await?;
    tracing::info!(ocr_job = %id, by_admin = %actor.id, "admin deleted OCR job");
    Ok(StatusCode::NO_CONTENT)
}

// ---------- /admin/services — background-service liveness --------------------
//
// Every long-lived service (crons, listeners, pollers, fan-out) beats into
// `service_heartbeats`; this surfaces the current liveness so the Tasks console
// can show services that have no per-run history.

async fn list_services_admin(
    State(state): State<AppState>,
    session: Session,
) -> AppResult<Json<Vec<ServiceHealth>>> {
    auth::require_admin(&session, &state.pool).await?;
    Ok(Json(service_health::list(&state.pool).await?))
}

async fn retry_scan(
    State(state): State<AppState>,
    session: Session,
    Path(id): Path<Uuid>,
) -> AppResult<StatusCode> {
    let actor = auth::require_admin(&session, &state.pool).await?;
    scan::admin_retry(&state.pool, id).await?;
    tracing::info!(scan = %id, by_admin = %actor.id, "admin re-queued scan");
    Ok(StatusCode::NO_CONTENT)
}

async fn fail_scan(
    State(state): State<AppState>,
    session: Session,
    Path(id): Path<Uuid>,
) -> AppResult<StatusCode> {
    let actor = auth::require_admin(&session, &state.pool).await?;
    scan::admin_mark_failed(&state.pool, id).await?;
    tracing::info!(scan = %id, by_admin = %actor.id, "admin marked scan failed");
    Ok(StatusCode::NO_CONTENT)
}

async fn delete_scan_admin(
    State(state): State<AppState>,
    session: Session,
    Path(id): Path<Uuid>,
) -> AppResult<StatusCode> {
    let actor = auth::require_admin(&session, &state.pool).await?;
    let (prefix, result_key) = scan::admin_delete(&state.pool, id).await?;
    crate::services::scan_cleanup::purge_scan_blobs(&state, &prefix, result_key.as_deref()).await;
    tracing::info!(scan = %id, by_admin = %actor.id, "admin deleted scan");
    Ok(StatusCode::NO_CONTENT)
}

// ---------- /admin/jobs — server background-job history ----------------------
//
// Runs of the server's own crons (release cron, scan cleanup, manga sync,
// price cron), recorded by services::job_runner. The SPA lists them on the
// Tasks page next to the worker scan queue, with "Serveur" as the executor.

async fn list_jobs_admin(
    State(state): State<AppState>,
    session: Session,
    Query(filter): Query<server_job::JobFilter>,
) -> AppResult<Json<server_job::JobRunsPage>> {
    auth::require_admin(&session, &state.pool).await?;
    Ok(Json(server_job::list_filtered(&state.pool, &filter).await?))
}

/// Relaunch a run's job: books a fresh `manual` run (attributed to the admin)
/// and executes it in the background. Any non-running run can be relaunched —
/// `ready` or `failed` — since a run is an execution record, not a unit of work
/// to mutate (the relaunched row stays in the history). `spawn_manual` still
/// 409s if that job is currently `processing`, so we never double-run it.
async fn retry_job(
    State(state): State<AppState>,
    session: Session,
    Path(id): Path<Uuid>,
) -> AppResult<Json<server_job::ServerJobRun>> {
    let actor = auth::require_admin(&session, &state.pool).await?;
    let run = server_job::get(&state.pool, id)
        .await?
        .ok_or(AppError::NotFound)?;
    let Some(new_id) =
        crate::services::job_runner::spawn_manual(&state, &run.job_name, Some(actor.id)).await?
    else {
        return Err(AppError::Conflict("job already running"));
    };
    tracing::info!(job = %run.job_name, run = %new_id, by_admin = %actor.id, "admin relaunched server job");
    let new_run = server_job::get(&state.pool, new_id)
        .await?
        .ok_or(AppError::NotFound)?;
    Ok(Json(new_run))
}

/// Delete a server-job run row (any state). Cancelling a still-`processing`
/// run = deleting its row; the in-process/worker task that finishes later just
/// UPDATEs 0 rows, harmlessly. 204 even if the id was already gone.
async fn delete_job_admin(
    State(state): State<AppState>,
    session: Session,
    Path(id): Path<Uuid>,
) -> AppResult<StatusCode> {
    let actor = auth::require_admin(&session, &state.pool).await?;
    server_job::delete(&state.pool, id).await?;
    tracing::info!(run = %id, by_admin = %actor.id, "admin deleted server job run");
    Ok(StatusCode::NO_CONTENT)
}

// ---------- /admin/settings --------------------------------------------------

async fn get_settings(
    State(state): State<AppState>,
    session: Session,
) -> AppResult<Json<settings::Settings>> {
    auth::require_admin(&session, &state.pool).await?;
    Ok(Json(settings::all(&state.pool).await?))
}

async fn patch_settings(
    State(state): State<AppState>,
    session: Session,
    Json(input): Json<settings::SettingsPatch>,
) -> AppResult<Json<settings::Settings>> {
    let actor = auth::require_admin(&session, &state.pool).await?;
    if let Some(policy) = input.gsplat_creation_policy.as_deref() {
        if !settings::is_valid_gsplat_policy(policy) {
            return Err(AppError::BadRequest("invalid gsplat_creation_policy"));
        }
        settings::set_gsplat_creation_policy(&state.pool, policy).await?;
        tracing::info!(by_admin = %actor.id, policy, "admin updated gsplat creation policy");
    }
    if let Some(schedule) = input.price_cron.as_deref() {
        let schedule = schedule.trim();
        if !settings::is_valid_price_cron(schedule) {
            return Err(AppError::BadRequest("invalid price_cron schedule"));
        }
        settings::set_price_cron_schedule(&state.pool, schedule).await?;
        tracing::info!(by_admin = %actor.id, schedule, "admin updated price-cron schedule");
    }
    if let Some(enabled) = input.visual_search {
        settings::set_visual_search_enabled(&state.pool, enabled).await?;
        tracing::info!(by_admin = %actor.id, enabled, "admin toggled visual search");
    }
    if let Some(enabled) = input.visual_search_external {
        settings::set_visual_search_external_enabled(&state.pool, enabled).await?;
        tracing::info!(by_admin = %actor.id, enabled, "admin toggled visual-search external fallback");
    }
    if let Some(key) = input.visual_search_external_key.as_deref() {
        settings::set_visual_search_external_api_key(&state.pool, key).await?;
        // Log only WHETHER a key is now set — never the secret itself.
        tracing::info!(
            by_admin = %actor.id,
            set = !key.trim().is_empty(),
            "admin updated visual-search external API key"
        );
    }
    if let Some(threshold) = input.visual_search_similarity_threshold {
        let clamped = threshold.clamp(0.0, 100.0);
        settings::set_visual_search_similarity_threshold(&state.pool, clamped).await?;
        tracing::info!(by_admin = %actor.id, threshold = clamped, "admin updated visual-search similarity threshold");
    }
    if let Some(enabled) = input.visual_search_ambiances {
        settings::set_visual_search_ambiances_enabled(&state.pool, enabled).await?;
        tracing::info!(by_admin = %actor.id, enabled, "admin toggled visual-search ambiances");
    }
    if let Some(enabled) = input.text_search {
        settings::set_text_search_enabled(&state.pool, enabled).await?;
        tracing::info!(by_admin = %actor.id, enabled, "admin toggled semantic text search");
    }
    if let Some(threshold) = input.text_search_min_match {
        let clamped = threshold.clamp(0.0, 100.0);
        settings::set_text_search_min_match(&state.pool, clamped).await?;
        tracing::info!(by_admin = %actor.id, threshold = clamped, "admin updated semantic text-search min match");
    }
    if let Some(enabled) = input.clip_search {
        settings::set_clip_search_enabled(&state.pool, enabled).await?;
        tracing::info!(by_admin = %actor.id, enabled, "admin toggled multimodal clip search");
    }
    if let Some(threshold) = input.clip_search_min_match {
        let clamped = threshold.clamp(0.0, 100.0);
        settings::set_clip_search_min_match(&state.pool, clamped).await?;
        tracing::info!(by_admin = %actor.id, threshold = clamped, "admin updated clip-search min match");
    }
    if let Some(enabled) = input.appearance_tags {
        settings::set_appearance_tags_enabled(&state.pool, enabled).await?;
        tracing::info!(by_admin = %actor.id, enabled, "admin toggled appearance tagging");
    }
    if let Some(enabled) = input.mcp {
        settings::set_mcp_enabled(&state.pool, enabled).await?;
        tracing::info!(by_admin = %actor.id, enabled, "admin toggled the MCP endpoint");
    }
    Ok(Json(settings::all(&state.pool).await?))
}

/// Queue every catalog image still missing an embedding for the current model
/// — the embed-capable worker drains the queue and writes the vectors. Returns
/// how many were queued.
/// `?force=true` wipes the index (vectors + queue rows) before re-enqueuing, for
/// a true from-scratch rebuild. Without it, we top up the rows still missing AND
/// re-arm any `failed` rows, so a plain re-trigger resumes stuck work instead of
/// silently no-op-ing on the `ON CONFLICT DO NOTHING`.
#[derive(serde::Deserialize)]
struct ReindexQuery {
    #[serde(default)]
    force: bool,
}

/// Record an admin reindex as a tracked server job (so it appears in the Tasks
/// history; the reconciler flips it to 'ready' with the final counts once the
/// queue drains), then run the wipe/enqueue. A wipe/enqueue error marks the job
/// failed. `start()` returns None when one is already in flight (single-flight) —
/// we still (re)enqueue, riding the existing job's history row.
async fn run_reindex(
    state: &AppState,
    kind: &str,
    force: bool,
    actor: Uuid,
) -> AppResult<serde_json::Value> {
    let run = server_job::start(
        &state.pool,
        visual_search::reindex_job_name(kind),
        "manual",
        Some(actor),
    )
    .await?;
    match visual_search::reindex(&state.pool, kind, force).await {
        Ok(queued) => Ok(json!({ "queued": queued })),
        Err(e) => {
            if let Some(id) = run {
                let _ = server_job::finish_failed(&state.pool, id, &e.to_string()).await;
            }
            Err(e)
        }
    }
}

async fn reindex_visual_search(
    State(state): State<AppState>,
    session: Session,
    Query(q): Query<ReindexQuery>,
) -> AppResult<Json<serde_json::Value>> {
    let actor = auth::require_admin(&session, &state.pool).await?;
    let out = run_reindex(&state, "image", q.force, actor.id).await?;
    tracing::info!(by_admin = %actor.id, force = q.force, "admin queued visual-search reindex");
    Ok(Json(out))
}

/// Queue every figure's text for semantic (e5-small) embedding.
async fn reindex_text_search(
    State(state): State<AppState>,
    session: Session,
    Query(q): Query<ReindexQuery>,
) -> AppResult<Json<serde_json::Value>> {
    let actor = auth::require_admin(&session, &state.pool).await?;
    let out = run_reindex(&state, "text", q.force, actor.id).await?;
    tracing::info!(by_admin = %actor.id, force = q.force, "admin queued text-search reindex");
    Ok(Json(out))
}

async fn reindex_clip_search(
    State(state): State<AppState>,
    session: Session,
    Query(q): Query<ReindexQuery>,
) -> AppResult<Json<serde_json::Value>> {
    let actor = auth::require_admin(&session, &state.pool).await?;
    let out = run_reindex(&state, "look", q.force, actor.id).await?;
    tracing::info!(by_admin = %actor.id, force = q.force, "admin queued clip-search reindex");
    Ok(Json(out))
}

async fn reindex_tags(
    State(state): State<AppState>,
    session: Session,
    Query(q): Query<ReindexQuery>,
) -> AppResult<Json<serde_json::Value>> {
    let actor = auth::require_admin(&session, &state.pool).await?;
    let out = run_reindex(&state, "tags", q.force, actor.id).await?;
    tracing::info!(by_admin = %actor.id, force = q.force, "admin queued appearance-tags reindex");
    Ok(Json(out))
}

/// Queue every owned photo lacking appearance tags for WD-Tagger (owned-photo
/// twin of `reindex_tags`). Lets the admin kick off tagging of the users'
/// uploaded photos so the collection tag filter has data.
async fn reindex_owned_tags(
    State(state): State<AppState>,
    session: Session,
    Query(q): Query<ReindexQuery>,
) -> AppResult<Json<serde_json::Value>> {
    let actor = auth::require_admin(&session, &state.pool).await?;
    let out = run_reindex(&state, "owned-tags", q.force, actor.id).await?;
    tracing::info!(by_admin = %actor.id, force = q.force, "admin queued owned-photo tags reindex");
    Ok(Json(out))
}

/// Force a from-scratch rebuild of ALL four indexes at once — the admin "Tout
/// réindexer de zéro" action.
async fn reindex_all(
    State(state): State<AppState>,
    session: Session,
) -> AppResult<Json<serde_json::Value>> {
    let actor = auth::require_admin(&session, &state.pool).await?;
    let run = server_job::start(
        &state.pool,
        visual_search::JOB_REINDEX_ALL,
        "manual",
        Some(actor.id),
    )
    .await?;
    match visual_search::reindex_all(&state.pool).await {
        Ok(queued) => {
            tracing::info!(by_admin = %actor.id, queued, "admin force-reindexed ALL indexes from scratch");
            Ok(Json(json!({ "queued": queued })))
        }
        Err(e) => {
            if let Some(id) = run {
                let _ = server_job::finish_failed(&state.pool, id, &e.to_string()).await;
            }
            Err(e)
        }
    }
}

/// The embed-queue progress for the admin Tasks view: per-state counts, index
/// size, last activity, and whether an embed-capable worker is live to drain it.
async fn visual_search_queue(
    State(state): State<AppState>,
    session: Session,
) -> AppResult<Json<serde_json::Value>> {
    auth::require_admin(&session, &state.pool).await?;
    let indexes = visual_search::all_index_queues(&state.pool).await?;
    let worker_present =
        crate::domain::worker::any_live_with_capability(&state.pool, "embed").await?;
    Ok(Json(json!({
        "indexes": indexes,
        "worker_present": worker_present,
    })))
}

/// Re-arm every failed embed-queue row so the worker takes another pass.
async fn retry_failed_embeddings(
    State(state): State<AppState>,
    session: Session,
) -> AppResult<Json<serde_json::Value>> {
    let actor = auth::require_admin(&session, &state.pool).await?;
    let requeued = visual_search::retry_failed(&state.pool, visual_search::MODEL_VERSION).await?;
    tracing::info!(by_admin = %actor.id, requeued, "admin re-queued failed embeddings");
    Ok(Json(json!({ "requeued": requeued })))
}

#[derive(serde::Deserialize)]
struct DuplicateQuery {
    /// Max cross-figure cosine distance to flag as a likely duplicate (0 =
    /// identical). Defaults to a conservative 0.15.
    max_distance: Option<f64>,
    limit: Option<i64>,
}

#[derive(serde::Serialize)]
struct DuplicatePairOut {
    distance: f32,
    a: figure::Figure,
    b: figure::Figure,
}

/// Catalogue duplicate detection — figure pairs that look visually
/// near-identical (the same figure listed twice, or a re-release). Hydrated
/// into full figures so the admin can eyeball them side by side; NSFW kept
/// (admin sees the whole catalogue). Empty `[]` when nothing is below threshold.
async fn visual_search_duplicates(
    State(state): State<AppState>,
    session: Session,
    Query(q): Query<DuplicateQuery>,
) -> AppResult<Json<Vec<DuplicatePairOut>>> {
    auth::require_admin(&session, &state.pool).await?;
    let max_distance = q.max_distance.unwrap_or(0.15).clamp(0.0, 2.0);
    let limit = q.limit.unwrap_or(50).clamp(1, 200);
    let pairs = visual_search::find_duplicates(
        &state.pool,
        visual_search::MODEL_VERSION,
        max_distance,
        limit,
    )
    .await?;
    if pairs.is_empty() {
        return Ok(Json(Vec::new()));
    }
    // Hydrate every figure across the pairs in one query, then build the cards.
    let mut ids: Vec<uuid::Uuid> = Vec::with_capacity(pairs.len() * 2);
    for p in &pairs {
        ids.push(p.figure_id_a);
        ids.push(p.figure_id_b);
    }
    let figures = figure::by_ids(&state.pool, &ids, false).await?;
    let by_id: std::collections::HashMap<uuid::Uuid, figure::Figure> =
        figures.into_iter().map(|f| (f.id, f)).collect();
    let out = pairs
        .into_iter()
        .filter_map(|p| {
            Some(DuplicatePairOut {
                distance: p.distance,
                a: by_id.get(&p.figure_id_a)?.clone(),
                b: by_id.get(&p.figure_id_b)?.clone(),
            })
        })
        .collect();
    Ok(Json(out))
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/admin/settings", get(get_settings).patch(patch_settings))
        .route("/admin/visual-search/reindex", post(reindex_visual_search))
        .route("/admin/visual-search/reindex-text", post(reindex_text_search))
        .route("/admin/visual-search/reindex-clip", post(reindex_clip_search))
        .route("/admin/visual-search/reindex-tags", post(reindex_tags))
        .route(
            "/admin/visual-search/reindex-owned-tags",
            post(reindex_owned_tags),
        )
        .route("/admin/visual-search/reindex-all", post(reindex_all))
        .route("/admin/visual-search/queue", get(visual_search_queue))
        .route(
            "/admin/visual-search/retry-failed",
            post(retry_failed_embeddings),
        )
        .route(
            "/admin/visual-search/duplicates",
            get(visual_search_duplicates),
        )
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
        // ─── manga servers — MangaCollector allow-list curation ─────────────
        .route("/admin/manga-servers", get(list_manga_servers))
        .route(
            "/admin/manga-servers/{id}",
            patch(patch_manga_server).delete(delete_manga_server),
        )
        .route("/admin/manga-servers/{id}/approve", post(approve_manga_server))
        .route("/admin/manga-servers/{id}/revoke", post(revoke_manga_server))
        // ─── scans — gsplat task queue ──────────────────────────────────────
        .route("/admin/scans", get(list_scans_admin))
        .route("/admin/scans/{id}", axum::routing::delete(delete_scan_admin))
        .route("/admin/scans/{id}/retry", post(retry_scan))
        .route("/admin/scans/{id}/fail", post(fail_scan))
        // ─── ocr-jobs — invoice-OCR task queue (list + delete) ──────────────
        .route("/admin/ocr-jobs", get(list_ocr_jobs_admin))
        .route(
            "/admin/ocr-jobs/{id}",
            axum::routing::delete(delete_ocr_job_admin),
        )
        // ─── services — background-service liveness register ────────────────
        .route("/admin/services", get(list_services_admin))
        .route("/admin/jobs", get(list_jobs_admin))
        .route("/admin/jobs/{id}/retry", post(retry_job))
        .route("/admin/jobs/{id}", axum::routing::delete(delete_job_admin))
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

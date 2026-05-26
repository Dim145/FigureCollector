//! `/api/admin/*` — staff-only endpoints, gated by `auth::require_admin`.

use crate::auth;
use crate::auth::user::User;
use crate::domain::admin::{self, NewAdminUser, UserPatch};
use crate::domain::entity::{self as ent, CharacterPatch, ManufacturerPatch, SeriesPatch};
use crate::domain::figure;
use crate::domain::figure_type::{self, FigureTypePatch, NewFigureType};
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use axum::{
    Json, Router,
    extract::{Multipart, Path, Query, State},
    http::StatusCode,
    routing::{get, patch, post},
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

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/admin/overview", get(overview))
        .route("/admin/users", get(list_users).post(create_user))
        .route(
            "/admin/users/{id}",
            axum::routing::patch(patch_user).delete(delete_user),
        )
        .route("/admin/figures", get(list_figures))
        // ─── catalog entities — JSON CRUD ────────────────────────────────
        .route("/admin/manufacturers", get(list_manufacturers))
        .route("/admin/manufacturers/{id}", patch(patch_manufacturer))
        .route("/admin/series", get(list_series))
        .route("/admin/series/{id}", patch(patch_series))
        .route("/admin/characters", get(list_characters))
        .route("/admin/characters/{id}", patch(patch_character))
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
        .route(
            "/admin/characters/{id}/photo",
            post(upload_character_photo),
        )
}

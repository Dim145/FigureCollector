//! `/api/me/owned/{id}/photos` (multipart upload + list) and
//! `/api/photos/{id}` (binary proxy).
//!
//! Validation pipeline:
//!   1. magic-bytes sniff via the `image` crate (rejects everything not JPEG/PNG/WebP)
//!   2. size cap (5 MB raw upload)
//!   3. decode → check dimensions (≤ 4096²) → re-encode as WebP
//!      → side-effect: EXIF metadata is dropped on the floor
//!   4. PUT the cleaned bytes to Garage, INSERT a `photos` row.

use crate::auth;
use crate::domain::photo;
use crate::error::{AppError, AppResult};
use crate::events::Event;
use crate::state::AppState;
use axum::{
    Json, Router,
    body::Body,
    extract::{Multipart, Path, State},
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
    routing::get,
};
use image::ImageFormat;
use std::io::Cursor;
use tower_sessions::Session;
use uuid::Uuid;

const MAX_PHOTO_BYTES: usize = 5 * 1024 * 1024; // 5 MB
const MAX_PHOTO_DIM: u32 = 4096;

async fn upload_photo(
    State(state): State<AppState>,
    session: Session,
    Path(owned_id): Path<Uuid>,
    mut multipart: Multipart,
) -> AppResult<(StatusCode, Json<photo::Photo>)> {
    let user = auth::require_user_full(&session, &state.pool).await?;
    photo::assert_owned_by(&state.pool, user.id, owned_id).await?;

    if !state.storage.enabled() {
        return Err(AppError::FeatureDisabled("object storage is not configured"));
    }

    // If the figure is NSFW and the user's pref is `blur`, refuse the upload.
    // The SPA disables the UI but we re-check server-side for safety.
    if user.nsfw_visibility == "blur" {
        let nsfw: Option<(bool,)> = sqlx::query_as(
            "SELECT f.is_nsfw FROM owned_items o
             JOIN figures f ON f.id = o.figure_id
             WHERE o.id = $1",
        )
        .bind(owned_id)
        .fetch_optional(&state.pool)
        .await?;
        if matches!(nsfw, Some((true,))) {
            return Err(AppError::Forbidden);
        }
    }
    let user_id = user.id;

    // We expect exactly one `file` field; ignore the rest.
    let mut bytes: Option<Vec<u8>> = None;
    while let Some(field) = multipart.next_field().await.map_err(|e| {
        AppError::BadRequest(Box::leak(format!("multipart error: {e}").into_boxed_str()))
    })? {
        if field.name() == Some("file") {
            let data = field
                .bytes()
                .await
                .map_err(|_| AppError::BadRequest("could not read upload body"))?;
            if data.len() > MAX_PHOTO_BYTES {
                return Err(AppError::BadRequest("photo too large (max 5 MB)"));
            }
            bytes = Some(data.to_vec());
            break;
        }
    }
    let raw = bytes.ok_or(AppError::BadRequest("missing 'file' multipart field"))?;

    // Decode + re-encode → strips EXIF + enforces format whitelist.
    let format = image::guess_format(&raw)
        .map_err(|_| AppError::BadRequest("unrecognised image format"))?;
    match format {
        ImageFormat::Jpeg | ImageFormat::Png | ImageFormat::WebP => {}
        _ => return Err(AppError::BadRequest("unsupported image format (use JPEG, PNG or WebP)")),
    }
    let img = image::load_from_memory_with_format(&raw, format)
        .map_err(|_| AppError::BadRequest("could not decode image"))?;
    let (w, h) = (img.width(), img.height());
    if w > MAX_PHOTO_DIM || h > MAX_PHOTO_DIM {
        return Err(AppError::BadRequest(
            "image dimensions too large (max 4096px per side)",
        ));
    }
    let mut cleaned = Vec::with_capacity(raw.len() / 2);
    img.write_to(&mut Cursor::new(&mut cleaned), ImageFormat::WebP)
        .map_err(|e| AppError::Internal(anyhow::anyhow!("WebP encode failed: {e}")))?;

    // Push to Garage and persist the row.
    let storage_key = format!("photos/{}.webp", Uuid::now_v7());
    state.storage.put(&storage_key, &cleaned, "image/webp").await?;

    let saved = photo::create(
        &state.pool,
        owned_id,
        &storage_key,
        "image/webp",
        w as i32,
        h as i32,
        cleaned.len() as i64,
    )
    .await?;

    // Fan out so other devices refresh their cached collection.
    state.events.publish(user_id, Event::OwnedItemPhotosChanged { owned_id });

    Ok((StatusCode::CREATED, Json(saved)))
}

async fn list_photos(
    State(state): State<AppState>,
    session: Session,
    Path(owned_id): Path<Uuid>,
) -> AppResult<Json<Vec<photo::Photo>>> {
    let user_id = auth::require_user(&session).await?;
    photo::assert_owned_by(&state.pool, user_id, owned_id).await?;
    Ok(Json(photo::list_for_owned(&state.pool, owned_id).await?))
}

async fn delete_photo(
    State(state): State<AppState>,
    session: Session,
    Path((owned_id, photo_id)): Path<(Uuid, Uuid)>,
) -> AppResult<StatusCode> {
    let user_id = auth::require_user(&session).await?;
    photo::assert_owned_by(&state.pool, user_id, owned_id).await?;

    let storage_key = photo::delete_and_return_key(&state.pool, user_id, photo_id).await?;
    // Best-effort delete on storage; if it fails we keep going (orphan blobs
    // can be GC'd later — the canonical record is gone from PG already).
    if let Err(e) = state.storage.delete(&storage_key).await {
        tracing::warn!(error = ?e, storage_key, "failed to delete blob");
    }

    state.events.publish(user_id, Event::OwnedItemPhotosChanged { owned_id });
    Ok(StatusCode::NO_CONTENT)
}

/// Public(-ish) photo proxy. Streams the WebP back through the backend so the
/// Garage bucket itself can stay private. Auth check: the owning user, or
/// anyone if the owning user has `public_profile_enabled = TRUE`.
async fn fetch_photo(
    State(state): State<AppState>,
    session: Session,
    Path(photo_id): Path<Uuid>,
) -> AppResult<Response> {
    let p = photo::find_by_id(&state.pool, photo_id)
        .await?
        .ok_or(AppError::NotFound)?;

    // Resolve the owning user + their public flag.
    let owner: Option<(Uuid, bool)> = sqlx::query_as(
        "SELECT u.id, u.public_profile_enabled
         FROM owned_items o JOIN users u ON u.id = o.user_id
         WHERE o.id = $1",
    )
    .bind(p.owned_item_id)
    .fetch_optional(&state.pool)
    .await?;
    let (owner_id, is_public) = owner.ok_or(AppError::NotFound)?;

    let viewer: Option<Uuid> = session.get("user_id").await?;
    let allowed = is_public || viewer == Some(owner_id);
    if !allowed {
        return Err(AppError::Forbidden);
    }

    let (bytes, mime) = state.storage.get(&p.storage_key).await?;
    let content_type = mime.unwrap_or_else(|| p.mime.clone());

    let mut headers = HeaderMap::new();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_str(&content_type)
            .unwrap_or_else(|_| HeaderValue::from_static("application/octet-stream")),
    );
    // 1 year cache; storage_key changes for every upload, so cache invalidation
    // happens naturally.
    headers.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("public, max-age=31536000, immutable"),
    );

    Ok((headers, Body::from(bytes)).into_response())
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/me/owned/{id}/photos",
            get(list_photos).post(upload_photo),
        )
        .route(
            "/me/owned/{owned_id}/photos/{photo_id}",
            axum::routing::delete(delete_photo),
        )
        .route("/photos/{id}", get(fetch_photo))
}

//! Catalog-side photos for figures.
//!
//!   GET    /api/figures/{id}/photos           — public list
//!   POST   /api/figures/{id}/photos           — auth, admin OR creator
//!   PATCH  /api/figures/{id}/photos/{pid}     — admin OR creator (set_primary only)
//!   DELETE /api/figures/{id}/photos/{pid}     — admin OR creator
//!   GET    /api/figure-photos/{id}            — public proxy of the WebP
//!
//! Reuses the same magic-byte + decode → re-encode as WebP pipeline as the
//! per-user photos route; this is *deliberate* — every uploaded image goes
//! through the same scrubbing regardless of which side of the catalog/
//! collection divide it belongs to.

use crate::auth;
use crate::domain::{figure, figure_photo};
use crate::error::{AppError, AppResult};
use crate::photo as photo_pipeline;
use crate::state::AppState;
use axum::{
    Json, Router,
    body::Body,
    extract::{Multipart, Path, State},
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
    routing::get,
};
use serde::Deserialize;
use tower_sessions::Session;
use uuid::Uuid;

const MAX_PHOTO_BYTES: usize = 5 * 1024 * 1024;
const MAX_PHOTO_DIM: u32 = 4096;

async fn list_photos(
    State(state): State<AppState>,
    Path(figure_id): Path<Uuid>,
) -> AppResult<Json<Vec<figure_photo::FigurePhoto>>> {
    Ok(Json(figure_photo::list(&state.pool, figure_id).await?))
}

async fn upload_photo(
    State(state): State<AppState>,
    session: Session,
    Path(figure_id): Path<Uuid>,
    mut multipart: Multipart,
) -> AppResult<(StatusCode, Json<figure_photo::FigurePhoto>)> {
    let user = auth::require_user_full(&session, &state.pool).await?;
    let f = figure::find_by_id(&state.pool, figure_id)
        .await?
        .ok_or(AppError::NotFound)?;
    // Admin OR creator — same gate as figure edit.
    let is_owner = f.created_by == Some(user.id);
    if !user.is_admin && !is_owner {
        return Err(AppError::Forbidden);
    }

    // Block uploads on NSFW figures when the user has opted into `blur` —
    // you can't moderate what you can't see clearly.
    if f.is_nsfw && user.nsfw_visibility == "blur" {
        return Err(AppError::Forbidden);
    }

    if !state.storage.enabled() {
        return Err(AppError::FeatureDisabled("object storage is not configured"));
    }

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

    // Shared pipeline: format whitelist + dimension cap + EXIF-stripping
    // WebP re-encode, off the runtime worker via `spawn_blocking`.
    let (cleaned, w, h) = photo_pipeline::sanitize_to_webp(raw, MAX_PHOTO_DIM).await?;

    // Push to Garage and persist the row. On INSERT failure, run a compensating
    // delete on the blob so Garage doesn't accumulate orphan WebPs with no
    // row referencing them.
    let storage_key = format!("figure-photos/{}.webp", Uuid::now_v7());
    state.storage.put(&storage_key, &cleaned, "image/webp").await?;

    let saved = match figure_photo::create(
        &state.pool,
        figure_id,
        &storage_key,
        "image/webp",
        w as i32,
        h as i32,
        cleaned.len() as i64,
        user.id,
    )
    .await
    {
        Ok(saved) => saved,
        Err(e) => {
            if let Err(del_err) = state.storage.delete(&storage_key).await {
                tracing::error!(
                    error = ?del_err,
                    %storage_key,
                    "orphan blob cleanup failed after figure_photo INSERT error"
                );
            }
            return Err(e);
        }
    };

    tracing::info!(
        figure_id = %figure_id,
        figure_photo_id = %saved.id,
        by_user = %user.id,
        as_admin = user.is_admin && !is_owner,
        "catalog photo uploaded",
    );
    Ok((StatusCode::CREATED, Json(saved)))
}

#[derive(Deserialize)]
struct PhotoPatch {
    /// If true and the row isn't already primary, promotes it.
    #[serde(default)]
    is_primary: bool,
}

async fn patch_photo(
    State(state): State<AppState>,
    session: Session,
    Path((figure_id, photo_id)): Path<(Uuid, Uuid)>,
    Json(input): Json<PhotoPatch>,
) -> AppResult<Json<figure_photo::FigurePhoto>> {
    let user = auth::require_user_full(&session, &state.pool).await?;
    let f = figure::find_by_id(&state.pool, figure_id)
        .await?
        .ok_or(AppError::NotFound)?;
    let is_owner = f.created_by == Some(user.id);
    if !user.is_admin && !is_owner {
        return Err(AppError::Forbidden);
    }

    if input.is_primary {
        figure_photo::set_primary(&state.pool, figure_id, photo_id).await?;
    }
    let updated = figure_photo::find_by_id(&state.pool, photo_id)
        .await?
        .ok_or(AppError::NotFound)?;
    Ok(Json(updated))
}

async fn delete_photo(
    State(state): State<AppState>,
    session: Session,
    Path((figure_id, photo_id)): Path<(Uuid, Uuid)>,
) -> AppResult<StatusCode> {
    let user = auth::require_user_full(&session, &state.pool).await?;
    let f = figure::find_by_id(&state.pool, figure_id)
        .await?
        .ok_or(AppError::NotFound)?;
    let is_owner = f.created_by == Some(user.id);
    if !user.is_admin && !is_owner {
        return Err(AppError::Forbidden);
    }

    let storage_key =
        figure_photo::delete_and_return_key(&state.pool, figure_id, photo_id).await?;
    if let Err(e) = state.storage.delete(&storage_key).await {
        tracing::warn!(error = ?e, storage_key, "failed to delete catalog photo blob");
    }
    Ok(StatusCode::NO_CONTENT)
}

/// Public proxy. Catalog photos are world-readable (the catalog itself is
/// authenticated, but no per-user gate on figure photos — admins/creators
/// already decided to publish them).
async fn fetch_photo(
    State(state): State<AppState>,
    Path(photo_id): Path<Uuid>,
) -> AppResult<Response> {
    let p = figure_photo::find_by_id(&state.pool, photo_id)
        .await?
        .ok_or(AppError::NotFound)?;
    let (bytes, mime) = state.storage.get(&p.storage_key).await?;
    let content_type = mime.unwrap_or_else(|| p.mime.clone());

    let mut headers = HeaderMap::new();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_str(&content_type)
            .unwrap_or_else(|_| HeaderValue::from_static("application/octet-stream")),
    );
    headers.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("public, max-age=31536000, immutable"),
    );
    Ok((headers, Body::from(bytes)).into_response())
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/figures/{id}/photos",
            get(list_photos).post(upload_photo),
        )
        .route(
            "/figures/{figure_id}/photos/{photo_id}",
            axum::routing::patch(patch_photo).delete(delete_photo),
        )
        .route("/figure-photos/{id}", get(fetch_photo))
}

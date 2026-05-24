//! `/api/me/owned/{id}/scans` — 360° turntable + (Phase 5B) Gaussian Splatting.
//!
//! Upload pipeline:
//!   1. Open a multipart request, the first field is the optional `kind`
//!      ("turntable" or "gsplat"; defaults to turntable in Phase 5A).
//!   2. Subsequent fields named `frame` carry the JPEG/PNG/WebP frames in
//!      capture order. Each is validated (magic-bytes + size + dimensions),
//!      re-encoded as WebP (EXIF stripped) and pushed to Garage under
//!      `scans/{scan_id}/frame_NN.webp`.
//!   3. The scan row is created up-front in `state = 'ready'` for turntable,
//!      or `state = 'pending'` for gsplat (Phase 5B's worker picks it up).
//!   4. After all frames land, `frame_count` is set in PG.
//!
//! Anyone (auth required) can read frames if the owner has a public profile;
//! otherwise only the owner.

use crate::auth;
use crate::domain::scan::{self, ALLOWED_KINDS};
use crate::error::{AppError, AppResult};
use crate::events::Event;
use crate::state::AppState;
use axum::{
    Json, Router,
    body::Body,
    extract::{Multipart, Path, State},
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
    routing::{delete, get, post},
};
use image::ImageFormat;
use std::io::Cursor;
use tower_sessions::Session;
use uuid::Uuid;

const MAX_FRAME_BYTES: usize = 5 * 1024 * 1024; // 5 MB per frame
const MAX_FRAME_DIM: u32 = 2048; // frames don't need to be huge — viewer thumbnail
const MIN_FRAMES: usize = 6;
const MAX_FRAMES: usize = 96;

#[derive(serde::Serialize)]
struct ScanCreated {
    scan: scan::Scan,
}

async fn create_scan(
    State(state): State<AppState>,
    session: Session,
    Path(owned_id): Path<Uuid>,
    mut multipart: Multipart,
) -> AppResult<(StatusCode, Json<ScanCreated>)> {
    let user_id = auth::require_user(&session).await?;
    scan::assert_owned_by(&state.pool, user_id, owned_id).await?;

    if !state.storage.enabled() {
        return Err(AppError::FeatureDisabled("object storage is not configured"));
    }

    // First pass: read multipart, separating the (optional) `kind` field from
    // the actual frames. We collect cleaned WebP buffers in memory — 96 frames
    // at ~300 KB each = ~30 MB worst case, acceptable.
    let mut kind = String::from("turntable");
    let mut frames: Vec<Vec<u8>> = Vec::new();

    while let Some(field) = multipart.next_field().await.map_err(|e| {
        AppError::BadRequest(Box::leak(format!("multipart error: {e}").into_boxed_str()))
    })? {
        match field.name() {
            Some("kind") => {
                let v = field
                    .text()
                    .await
                    .map_err(|_| AppError::BadRequest("could not read kind field"))?;
                if !ALLOWED_KINDS.contains(&v.as_str()) {
                    return Err(AppError::BadRequest("invalid scan kind"));
                }
                kind = v;
            }
            Some("frame") => {
                if frames.len() >= MAX_FRAMES {
                    return Err(AppError::BadRequest("too many frames (max 96)"));
                }
                let data = field
                    .bytes()
                    .await
                    .map_err(|_| AppError::BadRequest("could not read frame"))?;
                if data.len() > MAX_FRAME_BYTES {
                    return Err(AppError::BadRequest("frame too large (max 5 MB)"));
                }
                let format = image::guess_format(&data)
                    .map_err(|_| AppError::BadRequest("unrecognised frame format"))?;
                match format {
                    ImageFormat::Jpeg | ImageFormat::Png | ImageFormat::WebP => {}
                    _ => return Err(AppError::BadRequest("unsupported frame format")),
                }
                let img = image::load_from_memory_with_format(&data, format)
                    .map_err(|_| AppError::BadRequest("could not decode frame"))?;
                let (w, h) = (img.width(), img.height());
                if w > MAX_FRAME_DIM || h > MAX_FRAME_DIM {
                    return Err(AppError::BadRequest(
                        "frame dimensions too large (max 2048px per side)",
                    ));
                }
                let mut cleaned = Vec::with_capacity(data.len() / 2);
                img.write_to(&mut Cursor::new(&mut cleaned), ImageFormat::WebP)
                    .map_err(|e| {
                        AppError::Internal(anyhow::anyhow!("WebP encode failed: {e}"))
                    })?;
                frames.push(cleaned);
            }
            _ => {}
        }
    }

    if frames.len() < MIN_FRAMES {
        return Err(AppError::BadRequest("at least 6 frames required"));
    }

    // Reserve a scan row first, then upload each frame under the prefix.
    let scan_id = Uuid::now_v7();
    let storage_prefix = format!("scans/{scan_id}/");
    let initial_state = if kind == "gsplat" { "pending" } else { "ready" };

    let scan_row = scan::create(&state.pool, owned_id, &kind, &storage_prefix, initial_state).await?;

    let mut uploaded = 0usize;
    for (idx, bytes) in frames.iter().enumerate() {
        let key = format!("{storage_prefix}frame_{idx:03}.webp");
        if let Err(e) = state.storage.put(&key, bytes, "image/webp").await {
            // Cleanup what we managed to upload, then mark scan failed.
            for cleanup_idx in 0..uploaded {
                let _ = state
                    .storage
                    .delete(&format!("{storage_prefix}frame_{cleanup_idx:03}.webp"))
                    .await;
            }
            let _ = scan::mark_failed(&state.pool, scan_row.id, &format!("upload failed: {e}")).await;
            return Err(e);
        }
        uploaded += 1;
    }

    scan::set_frame_count(&state.pool, scan_row.id, frames.len() as i32).await?;

    // Refresh the row to capture frame_count + final state.
    let refreshed = scan::find_by_id(&state.pool, scan_row.id)
        .await?
        .ok_or(AppError::Internal(anyhow::anyhow!("scan vanished after create")))?;

    state
        .events
        .publish(user_id, Event::OwnedItemPhotosChanged { owned_id });

    tracing::info!(
        user_id = %user_id,
        owned_id = %owned_id,
        scan_id = %refreshed.id,
        kind = %refreshed.kind,
        frames = refreshed.frame_count,
        "scan created"
    );

    Ok((StatusCode::CREATED, Json(ScanCreated { scan: refreshed })))
}

async fn list_scans(
    State(state): State<AppState>,
    session: Session,
    Path(owned_id): Path<Uuid>,
) -> AppResult<Json<Vec<scan::Scan>>> {
    let user_id = auth::require_user(&session).await?;
    scan::assert_owned_by(&state.pool, user_id, owned_id).await?;
    Ok(Json(scan::list_for_owned(&state.pool, owned_id).await?))
}

async fn delete_scan(
    State(state): State<AppState>,
    session: Session,
    Path((owned_id, scan_id)): Path<(Uuid, Uuid)>,
) -> AppResult<StatusCode> {
    let user_id = auth::require_user(&session).await?;
    scan::assert_owned_by(&state.pool, user_id, owned_id).await?;
    let storage_prefix = scan::delete_for_user(&state.pool, user_id, scan_id).await?;

    // Best-effort blob cleanup. We don't know exact frame_count post-delete;
    // probe up to MAX_FRAMES — Garage shrugs at missing keys.
    for idx in 0..MAX_FRAMES {
        let _ = state
            .storage
            .delete(&format!("{storage_prefix}frame_{idx:03}.webp"))
            .await;
    }

    state
        .events
        .publish(user_id, Event::OwnedItemPhotosChanged { owned_id });
    Ok(StatusCode::NO_CONTENT)
}

async fn fetch_frame(
    State(state): State<AppState>,
    session: Session,
    Path((scan_id, idx)): Path<(Uuid, u32)>,
) -> AppResult<Response> {
    let scan_row = scan::find_by_id(&state.pool, scan_id)
        .await?
        .ok_or(AppError::NotFound)?;
    let viewer: Option<Uuid> = session.get("user_id").await?;
    scan::assert_visible(&state.pool, viewer, &scan_row).await?;
    if (idx as i32) >= scan_row.frame_count {
        return Err(AppError::NotFound);
    }

    let key = format!("{}frame_{:03}.webp", scan_row.storage_prefix, idx);
    let (bytes, mime) = state.storage.get(&key).await?;

    let mut headers = HeaderMap::new();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_str(mime.as_deref().unwrap_or("image/webp"))
            .unwrap_or_else(|_| HeaderValue::from_static("image/webp")),
    );
    headers.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("public, max-age=31536000, immutable"),
    );
    Ok((headers, Body::from(bytes)).into_response())
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/me/owned/{id}/scans", get(list_scans).post(create_scan))
        .route("/me/owned/{owned_id}/scans/{scan_id}", delete(delete_scan))
        .route("/scans/{scan_id}/frames/{idx}", get(fetch_frame))
}

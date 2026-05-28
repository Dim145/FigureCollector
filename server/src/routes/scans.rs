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
use crate::domain::achievement;
use crate::domain::scan::{self, ALLOWED_KINDS};
use crate::error::{AppError, AppResult};
use crate::events::Event;
use crate::photo as photo_pipeline;
use crate::state::AppState;
use axum::{
    Json, Router,
    body::Body,
    extract::{Multipart, Path, State},
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
    routing::{delete, get},
};
use futures::stream::StreamExt;
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
    // For gsplat scans the client may also ship the original capture video, so
    // the worker can extract full-resolution frames itself rather than relying
    // on the downscaled WebP set. (bytes, extension, mime).
    let mut video: Option<(Vec<u8>, String, String)> = None;

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
                let data = field.bytes().await.map_err(|e| {
                    // Keep the underlying multer error in the server log so
                    // operators can tell apart "client gave up" vs nginx
                    // truncation vs malformed multipart.
                    tracing::warn!(error = ?e, frame_index = frames.len(), "scan frame read failed");
                    AppError::BadRequest("could not read frame")
                })?;
                if data.len() > MAX_FRAME_BYTES {
                    return Err(AppError::BadRequest("frame too large (max 5 MB)"));
                }
                // Shared pipeline (off the runtime worker via spawn_blocking).
                // 96 frames × ~80 ms of CPU each would otherwise pin a single
                // tokio worker for ~8 s with this one upload.
                let (cleaned, _w, _h) =
                    photo_pipeline::sanitize_to_webp(data.to_vec(), MAX_FRAME_DIM).await?;
                frames.push(cleaned);
            }
            Some("video") => {
                // Owned copies first — these borrow `field`, which `bytes()`
                // then consumes.
                let ext = field
                    .file_name()
                    .and_then(|n| n.rsplit('.').next())
                    .map(|e| e.to_ascii_lowercase())
                    .filter(|e| matches!(e.as_str(), "mp4" | "mov" | "m4v" | "webm" | "avi"))
                    .unwrap_or_else(|| "mp4".to_string());
                let mime = field
                    .content_type()
                    .map(|s| s.to_string())
                    .unwrap_or_else(|| "video/mp4".to_string());
                let data = field.bytes().await.map_err(|e| {
                    tracing::warn!(error = ?e, "scan video read failed");
                    AppError::BadRequest("could not read video")
                })?;
                if !data.is_empty() {
                    video = Some((data.to_vec(), ext, mime));
                }
            }
            _ => {}
        }
    }

    // A gsplat scan may ship *just* the original video (no client-extracted
    // frames) — the worker samples its own frames from it. Otherwise we need
    // the usual >= 6 frames (e.g. a turntable scan, or the 360° viewer).
    if frames.len() < MIN_FRAMES && video.is_none() {
        return Err(AppError::BadRequest("at least 6 frames required"));
    }

    // Reserve a scan row first, then upload each frame under the prefix.
    let scan_id = Uuid::now_v7();
    let storage_prefix = format!("scans/{scan_id}/");
    // Create gsplat scans as 'processing' (a transient "uploading" marker), NOT
    // 'pending' — otherwise the worker, which polls for pending gsplat scans,
    // can claim one before its frames/video have finished uploading to Garage
    // and fail with "0 usable frames". We flip it to 'pending' as the final
    // step below, once every asset is stored. (Turntable is done immediately.)
    let initial_state = if kind == "gsplat" { "processing" } else { "ready" };

    let scan_row = scan::create(&state.pool, owned_id, &kind, &storage_prefix, initial_state).await?;

    // Upload frames CONCURRENTLY to Garage. Sequentially this spent ~50 ms
    // of RTT per put × 96 frames ≈ 5 s of pure wall-clock waiting on the
    // network. With a window of 8 in-flight puts the same upload finishes
    // in ~600 ms RTT-bound. Errors short-circuit the whole batch and we
    // clean up the frames that did land.
    //
    // We `into_iter()` the frames Vec so each future owns its bytes
    // (the alternative — borrowing — runs into the "closure with
    // signature `for<'a>` is not general enough" lifetime gymnastics
    // that `buffer_unordered` doesn't compose with).
    const UPLOAD_CONCURRENCY: usize = 8;
    let frame_count = frames.len();
    let upload_result = futures::stream::iter(frames.into_iter().enumerate())
        .map(|(idx, bytes)| {
            let storage = state.storage.clone();
            let prefix = storage_prefix.clone();
            async move {
                let key = format!("{prefix}frame_{idx:03}.webp");
                storage.put(&key, &bytes, "image/webp").await.map(|_| idx)
            }
        })
        .buffer_unordered(UPLOAD_CONCURRENCY)
        .collect::<Vec<_>>()
        .await;

    let mut uploaded_indices: Vec<usize> = Vec::with_capacity(frame_count);
    let mut first_err: Option<AppError> = None;
    for r in upload_result {
        match r {
            Ok(idx) => uploaded_indices.push(idx),
            Err(e) if first_err.is_none() => first_err = Some(e),
            Err(_) => {}
        }
    }
    if let Some(e) = first_err {
        for idx in &uploaded_indices {
            let _ = state
                .storage
                .delete(&format!("{storage_prefix}frame_{idx:03}.webp"))
                .await;
        }
        let _ = scan::mark_failed(&state.pool, scan_row.id, &format!("upload failed: {e}")).await;
        return Err(e);
    }
    let uploaded = uploaded_indices.len();

    // If the UPDATE or the refresh SELECT fails after every frame is already
    // in Garage we need to wipe the frames + mark the scan as failed; the
    // scan_row would otherwise look like a stale ready/pending entry with
    // frame_count=0 and a pile of orphan blobs underneath it.
    let cleanup_frames = |state: AppState, prefix: String, count: usize| async move {
        for cleanup_idx in 0..count {
            let _ = state
                .storage
                .delete(&format!("{prefix}frame_{cleanup_idx:03}.webp"))
                .await;
        }
    };

    if let Err(e) = scan::set_frame_count(&state.pool, scan_row.id, frame_count as i32).await {
        cleanup_frames(state.clone(), storage_prefix.clone(), uploaded).await;
        let _ = scan::mark_failed(&state.pool, scan_row.id, &format!("frame_count update failed: {e}")).await;
        return Err(e);
    }

    // Store the original video (gsplat only) at `{prefix}source.<ext>` so the
    // splat worker can extract full-res frames. Non-fatal: if it fails, the
    // worker falls back to the WebP frames we already uploaded.
    if let Some((bytes, ext, mime)) = video {
        let key = format!("{storage_prefix}source.{ext}");
        if let Err(e) = state.storage.put(&key, &bytes, &mime).await {
            tracing::warn!(error = ?e, scan_id = %scan_row.id, "scan source-video store failed");
        } else {
            tracing::info!(scan_id = %scan_row.id, bytes = bytes.len(), "scan source video stored");
        }
    }

    // All assets are in Garage now — make the gsplat scan claimable. (No-op
    // for turntable, which was created 'ready'.)
    if kind == "gsplat" {
        if let Err(e) = scan::mark_pending(&state.pool, scan_row.id).await {
            cleanup_frames(state.clone(), storage_prefix.clone(), uploaded).await;
            let _ = scan::mark_failed(&state.pool, scan_row.id, &format!("activation failed: {e}")).await;
            return Err(e);
        }
    }

    // Refresh the row to capture frame_count + final state.
    let refreshed = match scan::find_by_id(&state.pool, scan_row.id).await {
        Ok(Some(r)) => r,
        Ok(None) => {
            cleanup_frames(state.clone(), storage_prefix.clone(), uploaded).await;
            return Err(AppError::Internal(anyhow::anyhow!("scan vanished after create")));
        }
        Err(e) => {
            cleanup_frames(state.clone(), storage_prefix.clone(), uploaded).await;
            return Err(e);
        }
    };

    state
        .events
        .publish(user_id, Event::OwnedItemPhotosChanged { owned_id });

    // The scan's owned-item points at a figure — resolve and pass it so the
    // achievement seal shows that piece's photo.
    let trigger_figure_id: Option<Uuid> = sqlx::query_scalar(
        "SELECT figure_id FROM owned_items WHERE id = $1 LIMIT 1",
    )
    .bind(owned_id)
    .fetch_optional(&state.pool)
    .await
    .ok()
    .flatten();
    if let Ok(newly) =
        achievement::check_and_grant(&state.db, &state.pool, user_id, trigger_figure_id).await
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

/// Phase 5B: stream the trained Gaussian Splat (`result.ply`) back through
/// the backend so Garage can stay private.
async fn fetch_splat(
    State(state): State<AppState>,
    session: Session,
    Path(scan_id): Path<Uuid>,
) -> AppResult<Response> {
    let scan_row = scan::find_by_id(&state.pool, scan_id)
        .await?
        .ok_or(AppError::NotFound)?;
    let viewer: Option<Uuid> = session.get("user_id").await?;
    scan::assert_visible(&state.pool, viewer, &scan_row).await?;

    if scan_row.state != "ready" {
        return Err(AppError::NotFound);
    }
    let result_key = scan_row
        .result_key
        .as_deref()
        .ok_or(AppError::NotFound)?;

    let (bytes, mime) = state.storage.get(result_key).await?;
    let mut headers = HeaderMap::new();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_str(mime.as_deref().unwrap_or("model/ply"))
            .unwrap_or_else(|_| HeaderValue::from_static("model/ply")),
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
        .route("/scans/{scan_id}/splat", get(fetch_splat))
}

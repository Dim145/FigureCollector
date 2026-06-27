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
use crate::domain::{photo, visual_search};
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
    routing::get,
};
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
        tracing::warn!(error = %e, "multipart framing error");
        AppError::BadRequest("malformed multipart request")
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

    // Decode + re-encode → strips EXIF + enforces format whitelist + caps
    // dimensions. Runs inside `spawn_blocking` so multi-megapixel JPEGs
    // don't stall the runtime worker thread.
    let (cleaned, w, h) = photo_pipeline::sanitize_to_webp(raw, MAX_PHOTO_DIM).await?;

    // Push to Garage and persist the row. If the DB insert fails after the
    // blob is already in S3, run a compensating delete so we don't leave an
    // orphan WebP in Garage with no row referencing it (there's no GC sweep).
    let storage_key = format!("photos/{}.webp", Uuid::now_v7());
    state.storage.put(&storage_key, &cleaned, "image/webp").await?;

    let saved = match photo::create(
        &state.pool,
        owned_id,
        &storage_key,
        "image/webp",
        w as i32,
        h as i32,
        cleaned.len() as i64,
    )
    .await
    {
        Ok(saved) => saved,
        Err(e) => {
            if let Err(del_err) = state.storage.delete(&storage_key).await {
                tracing::error!(
                    error = ?del_err,
                    %storage_key,
                    "orphan blob cleanup failed after photo INSERT error"
                );
            }
            return Err(e);
        }
    };

    // Auto-tag the new photo (WD-Tagger) so the collection tag filter has data.
    // Best-effort + feature-gated; never blocks the upload response.
    visual_search::enqueue_owned_photo_tags_if_enabled(&state.pool, saved.id).await;

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

/// Replace an existing photo's image in place (edit-in-place from the editor).
/// Same validation pipeline as upload; keeps the row's position, swaps the
/// stored blob, drops the old one. Owner-gated + NSFW gate, exactly like upload.
async fn replace_photo(
    State(state): State<AppState>,
    session: Session,
    Path((owned_id, photo_id)): Path<(Uuid, Uuid)>,
    mut multipart: Multipart,
) -> AppResult<Json<photo::Photo>> {
    let user = auth::require_user_full(&session, &state.pool).await?;
    photo::assert_owned_by(&state.pool, user.id, owned_id).await?;

    if !state.storage.enabled() {
        return Err(AppError::FeatureDisabled("object storage is not configured"));
    }
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
            if data.len() > MAX_PHOTO_BYTES {
                return Err(AppError::BadRequest("photo too large (max 5 MB)"));
            }
            bytes = Some(data.to_vec());
            break;
        }
    }
    let raw = bytes.ok_or(AppError::BadRequest("missing 'file' multipart field"))?;
    let (cleaned, w, h) = photo_pipeline::sanitize_to_webp(raw, MAX_PHOTO_DIM).await?;

    let storage_key = format!("photos/{}.webp", Uuid::now_v7());
    state.storage.put(&storage_key, &cleaned, "image/webp").await?;

    let (saved, old_key) = match photo::replace_image(
        &state.pool,
        user.id,
        photo_id,
        &storage_key,
        "image/webp",
        w as i32,
        h as i32,
        cleaned.len() as i64,
    )
    .await
    {
        Ok(v) => v,
        Err(e) => {
            if let Err(del_err) = state.storage.delete(&storage_key).await {
                tracing::error!(error = ?del_err, %storage_key, "orphan blob cleanup failed after photo replace error");
            }
            return Err(e);
        }
    };
    // Drop the previous blob (best-effort).
    if let Err(e) = state.storage.delete(&old_key).await {
        tracing::warn!(error = ?e, old_key, "failed to delete replaced photo blob");
    }

    // The edited image invalidated the old tags (replace_image cleared them);
    // re-tag the new bytes. Best-effort + feature-gated.
    visual_search::enqueue_owned_photo_tags_if_enabled(&state.pool, saved.id).await;

    state.events.publish(user.id, Event::OwnedItemPhotosChanged { owned_id });
    Ok(Json(saved))
}

/// Authorization predicate for the public photo proxy, extracted so the
/// security matrix is unit-testable without a DB. A non-owner may fetch a photo
/// ONLY when it's the piece's pinned cover (`is_cover`) on a public profile
/// that permits this piece's NSFW state — gallery photos stay private to the
/// owner. The owner always sees their own photos.
fn photo_visible(
    viewer: Option<Uuid>,
    owner_id: Uuid,
    is_public: bool,
    show_nsfw: bool,
    is_nsfw: bool,
    is_cover: bool,
) -> bool {
    viewer == Some(owner_id) || (is_public && (show_nsfw || !is_nsfw) && is_cover)
}

/// Public(-ish) photo proxy. Streams the WebP back through the backend so the
/// Garage bucket itself can stay private. Auth: the owner, or — for a public
/// profile — only the piece's pinned COVER (never arbitrary gallery photos),
/// subject to the profile's NSFW preference. See `photo_visible`.
async fn fetch_photo(
    State(state): State<AppState>,
    session: Session,
    req_headers: HeaderMap,
    Path(photo_id): Path<Uuid>,
) -> AppResult<Response> {
    let p = photo::find_by_id(&state.pool, photo_id)
        .await?
        .ok_or(AppError::NotFound)?;

    // Resolve the owning user + their public/NSFW flags + the piece's NSFW
    // flag (joined via owned_items → figures), so a non-owner can't pull an
    // NSFW photo off a public profile that opted out of sharing NSFW. Also flag
    // whether this photo is the piece's pinned cover — the only photo any public
    // surface (profile vitrine, compare) ever exposes.
    let owner: Option<(Uuid, bool, bool, bool, bool)> = sqlx::query_as(
        "SELECT u.id, u.public_profile_enabled, u.public_profile_show_nsfw, f.is_nsfw,
                COALESCE(o.cover_photo_id = $2, FALSE) AS is_cover
         FROM owned_items o
         JOIN users u ON u.id = o.user_id
         JOIN figures f ON f.id = o.figure_id
         WHERE o.id = $1",
    )
    .bind(p.owned_item_id)
    .bind(photo_id)
    .fetch_optional(&state.pool)
    .await?;
    let (owner_id, is_public, show_nsfw, is_nsfw, is_cover) = owner.ok_or(AppError::NotFound)?;

    let viewer: Option<Uuid> = session.get("user_id").await?;
    if !photo_visible(viewer, owner_id, is_public, show_nsfw, is_nsfw, is_cover) {
        return Err(AppError::Forbidden);
    }

    // ETag = the storage_key (unique per stored image). Photos are now mutable
    // (edit-in-place), so we can't promise `immutable`; instead we revalidate.
    // An edit swaps storage_key → the ETag changes → the cached copy is
    // replaced EVERYWHERE the photo appears (cover, cards, lightbox…), not just
    // the gallery. Unchanged images cost only a cheap 304 (no storage read).
    let etag = format!("\"{}\"", p.storage_key);
    let cache = "private, max-age=0, must-revalidate";
    if req_headers
        .get(header::IF_NONE_MATCH)
        .and_then(|v| v.to_str().ok())
        == Some(etag.as_str())
    {
        let mut h = HeaderMap::new();
        h.insert(header::ETAG, HeaderValue::from_str(&etag).unwrap());
        h.insert(header::CACHE_CONTROL, HeaderValue::from_static(cache));
        return Ok((StatusCode::NOT_MODIFIED, h).into_response());
    }

    let (bytes, mime) = state.storage.get(&p.storage_key).await?;
    let content_type = mime.unwrap_or_else(|| p.mime.clone());

    let mut headers = HeaderMap::new();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_str(&content_type)
            .unwrap_or_else(|_| HeaderValue::from_static("application/octet-stream")),
    );
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static(cache));
    headers.insert(
        header::ETAG,
        HeaderValue::from_str(&etag).unwrap_or_else(|_| HeaderValue::from_static("\"\"")),
    );
    // Bytes are always re-encoded WebP, but send nosniff anyway for parity with
    // the document proxy so a browser can never sniff the response into
    // something executable if the re-encode invariant ever changes.
    headers.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );

    Ok((headers, Body::from(bytes)).into_response())
}

/// Internal owned-photo proxy for the indexing worker (appearance tagging).
///
/// Owned photos are user-PRIVATE — the public `/photos/{id}` proxy gates them to
/// the owner (or a published cover), so the worker (which has no session) can't
/// use it. This route streams ANY owned photo's bytes, gated instead by a shared
/// bearer token (`WORKER_INTERNAL_TOKEN`). When the token is unset the route is
/// disabled (404), so owned-photo tagging stays off until an operator opts in.
/// Never exposed to the SPA; the worker reaches it on the trusted internal
/// network (server hostname), same as its DB connection.
async fn fetch_owned_photo_internal(
    State(state): State<AppState>,
    req_headers: HeaderMap,
    Path(photo_id): Path<Uuid>,
) -> AppResult<Response> {
    // Disabled unless a token is configured — fail closed (404, not 401, so the
    // route is indistinguishable from "not mounted" to an unauthenticated probe).
    let Some(expected) = state.config.worker_internal_token.as_deref() else {
        return Err(AppError::NotFound);
    };
    let presented = req_headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .unwrap_or("");
    // Length-independent constant-time compare so a wrong token leaks nothing
    // through timing (high-entropy shared secret; no extra crate needed).
    if !constant_time_eq(presented.as_bytes(), expected.as_bytes()) {
        return Err(AppError::Forbidden);
    }

    let p = photo::find_by_id(&state.pool, photo_id)
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
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
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
            axum::routing::put(replace_photo).delete(delete_photo),
        )
        .route("/photos/{id}", get(fetch_photo))
        .route(
            "/internal/owned-photos/{id}",
            get(fetch_owned_photo_internal),
        )
}

/// Constant-time byte-slice equality. Folds a length difference into the
/// accumulator so unequal lengths still take the same path (no early return on
/// length), avoiding a timing side-channel on the worker token.
fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    let mut diff = (a.len() ^ b.len()) as u8;
    let n = a.len().max(b.len());
    for i in 0..n {
        let x = a.get(i).copied().unwrap_or(0);
        let y = b.get(i).copied().unwrap_or(0);
        diff |= x ^ y;
    }
    diff == 0
}

#[cfg(test)]
mod tests {
    use super::{constant_time_eq, photo_visible};
    use uuid::Uuid;

    #[test]
    fn constant_time_eq_matches_only_identical_slices() {
        assert!(constant_time_eq(b"secret-token", b"secret-token"));
        assert!(!constant_time_eq(b"secret-token", b"secret-toker"));
        assert!(!constant_time_eq(b"secret-token", b"secret-token-longer"));
        assert!(!constant_time_eq(b"", b"x"));
        assert!(constant_time_eq(b"", b""));
    }

    fn owner() -> Uuid {
        Uuid::from_u128(1)
    }
    fn stranger() -> Option<Uuid> {
        Some(Uuid::from_u128(2))
    }

    #[test]
    fn owner_sees_any_of_their_own_photos() {
        // Even a private, non-cover, NSFW photo — the owner always sees their own.
        assert!(photo_visible(Some(owner()), owner(), false, false, true, false));
    }

    #[test]
    fn non_owner_gets_the_public_cover() {
        assert!(photo_visible(stranger(), owner(), true, false, false, true));
    }

    #[test]
    fn non_owner_cannot_get_a_non_cover_gallery_photo() {
        // The regression this hardening closes: a non-cover gallery photo of a
        // public profile must NOT be fetchable by a non-owner.
        assert!(!photo_visible(stranger(), owner(), true, false, false, false));
    }

    #[test]
    fn non_owner_cannot_get_a_cover_on_a_private_profile() {
        assert!(!photo_visible(stranger(), owner(), false, false, false, true));
    }

    #[test]
    fn non_owner_nsfw_cover_follows_the_profile_preference() {
        // NSFW cover hidden unless the owner publishes NSFW…
        assert!(!photo_visible(stranger(), owner(), true, false, true, true));
        // …and shown when they do.
        assert!(photo_visible(stranger(), owner(), true, true, true, true));
    }

    #[test]
    fn anonymous_viewer_is_treated_as_a_non_owner() {
        assert!(photo_visible(None, owner(), true, false, false, true)); // public cover ok
        assert!(!photo_visible(None, owner(), true, false, false, false)); // non-cover denied
    }
}

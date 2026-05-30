//! `/api/me/owned/{id}/documents` (multipart upload + list, owner-gated) and
//! `/api/documents/{id}` (PRIVATE binary proxy — owner only).
//!
//! Receipts / invoices / customs slips for an owned item. Unlike photos, the
//! bytes are stored as-is (no WebP re-encode — a PDF must stay a PDF) and the
//! proxy never serves them to anyone but the owner. We still validate the
//! magic bytes (PDF / JPEG / PNG / WebP) so the store can't be used as an
//! arbitrary file dump.

use crate::auth;
use crate::domain::owned_document as doc;
use crate::error::{AppError, AppResult};
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

const MAX_DOC_BYTES: usize = 10 * 1024 * 1024; // 10 MB

/// Magic-byte sniff. Returns the canonical mime for an accepted type, else
/// `None` (rejected). We trust this over the client-declared content-type.
fn sniff_mime(b: &[u8]) -> Option<&'static str> {
    if b.starts_with(b"%PDF-") {
        return Some("application/pdf");
    }
    if b.starts_with(&[0xFF, 0xD8, 0xFF]) {
        return Some("image/jpeg");
    }
    if b.starts_with(&[0x89, 0x50, 0x4E, 0x47]) {
        return Some("image/png");
    }
    if b.len() >= 12 && &b[0..4] == b"RIFF" && &b[8..12] == b"WEBP" {
        return Some("image/webp");
    }
    None
}

async fn list_documents(
    State(state): State<AppState>,
    session: Session,
    Path(owned_id): Path<Uuid>,
) -> AppResult<Json<Vec<doc::OwnedDocument>>> {
    let user_id = auth::require_user(&session).await?;
    doc::assert_owned_by(&state.pool, user_id, owned_id).await?;
    Ok(Json(doc::list(&state.pool, owned_id).await?))
}

async fn upload_document(
    State(state): State<AppState>,
    session: Session,
    Path(owned_id): Path<Uuid>,
    mut multipart: Multipart,
) -> AppResult<(StatusCode, Json<doc::OwnedDocument>)> {
    let user_id = auth::require_user(&session).await?;
    doc::assert_owned_by(&state.pool, user_id, owned_id).await?;

    if !state.storage.enabled() {
        return Err(AppError::FeatureDisabled("object storage is not configured"));
    }

    let mut bytes: Option<Vec<u8>> = None;
    let mut filename = String::from("document");
    while let Some(field) = multipart.next_field().await.map_err(|e| {
        AppError::BadRequest(Box::leak(format!("multipart error: {e}").into_boxed_str()))
    })? {
        if field.name() == Some("file") {
            if let Some(fname) = field.file_name() {
                let clean = fname.trim();
                if !clean.is_empty() {
                    filename = clean.chars().take(160).collect();
                }
            }
            let data = field
                .bytes()
                .await
                .map_err(|_| AppError::BadRequest("could not read upload body"))?;
            if data.len() > MAX_DOC_BYTES {
                return Err(AppError::BadRequest("document too large (max 10 MB)"));
            }
            bytes = Some(data.to_vec());
            break;
        }
    }
    let raw = bytes.ok_or(AppError::BadRequest("missing 'file' multipart field"))?;
    let mime = sniff_mime(&raw)
        .ok_or(AppError::BadRequest("unsupported file (PDF / JPG / PNG / WebP only)"))?;

    // Strip a path-traversal-y filename to its basename; keep it human-readable.
    let filename = filename
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(&filename)
        .to_string();

    let storage_key = format!("documents/{}", Uuid::now_v7());
    state.storage.put(&storage_key, &raw, mime).await?;

    let saved = match doc::create(
        &state.pool,
        owned_id,
        user_id,
        &storage_key,
        &filename,
        mime,
        raw.len() as i64,
    )
    .await
    {
        Ok(saved) => saved,
        Err(e) => {
            if let Err(del) = state.storage.delete(&storage_key).await {
                tracing::error!(error = ?del, %storage_key, "orphan blob cleanup failed after document INSERT error");
            }
            return Err(e);
        }
    };
    Ok((StatusCode::CREATED, Json(saved)))
}

async fn delete_document(
    State(state): State<AppState>,
    session: Session,
    Path((_owned_id, doc_id)): Path<(Uuid, Uuid)>,
) -> AppResult<StatusCode> {
    let user_id = auth::require_user(&session).await?;
    let storage_key = doc::delete_and_return_key(&state.pool, user_id, doc_id).await?;
    if let Err(e) = state.storage.delete(&storage_key).await {
        tracing::warn!(error = ?e, storage_key, "failed to delete document blob");
    }
    Ok(StatusCode::NO_CONTENT)
}

/// PRIVATE proxy: streams the document only to its owner. Served inline so a
/// PDF/image opens in the browser; never cached by shared caches.
async fn fetch_document(
    State(state): State<AppState>,
    session: Session,
    Path(doc_id): Path<Uuid>,
) -> AppResult<Response> {
    let user_id = auth::require_user(&session).await?;
    let (storage_key, mime, filename) =
        doc::find_for_owner(&state.pool, user_id, doc_id).await?;

    let (bytes, stored_mime) = state.storage.get(&storage_key).await?;
    let content_type = stored_mime.unwrap_or(mime);

    let mut headers = HeaderMap::new();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_str(&content_type)
            .unwrap_or_else(|_| HeaderValue::from_static("application/octet-stream")),
    );
    headers.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("private, no-store"),
    );
    // ASCII-safe disposition; the SPA already knows the real filename.
    let ascii: String = filename
        .chars()
        .map(|c| if c.is_ascii() && c != '"' { c } else { '_' })
        .collect();
    if let Ok(v) = HeaderValue::from_str(&format!("inline; filename=\"{ascii}\"")) {
        headers.insert(header::CONTENT_DISPOSITION, v);
    }
    Ok((headers, Body::from(bytes)).into_response())
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/me/owned/{id}/documents",
            get(list_documents).post(upload_document),
        )
        .route(
            "/me/owned/{owned_id}/documents/{doc_id}",
            axum::routing::delete(delete_document),
        )
        .route("/documents/{id}", get(fetch_document))
}

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
use crate::domain::{ocr_job, worker};
use crate::error::{AppError, AppResult};
use crate::services::invoice;
use crate::state::AppState;
use axum::{
    Json, Router,
    body::Body,
    extract::{Multipart, Path, State},
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
    routing::get,
};
use serde::Serialize;
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
        tracing::warn!(error = %e, "multipart framing error");
        AppError::BadRequest("malformed multipart request")
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
    // Defense-in-depth: even if the front proxy is bypassed, an owner-uploaded
    // PDF/image must not be MIME-sniffed or able to execute script. `sandbox`
    // (with no allow-tokens) drops scripts, plugins, same-origin, popups, etc.
    headers.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    headers.insert(
        header::CONTENT_SECURITY_POLICY,
        HeaderValue::from_static("sandbox; default-src 'none'"),
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

/// Response for the parse endpoint: the document's extracted fields (when a
/// suggestion is available now), an optional `note` describing an async/blocked
/// state, and the running cumulative rollup across every parsed document.
#[derive(Serialize)]
struct ParseResponse {
    extracted: Option<invoice::ParsedInvoice>,
    /// "ocr_queued" | "ocr_pending" | "ocr_unavailable" | "extract_failed",
    /// else absent (a suggestion is in `extracted`).
    note: Option<&'static str>,
    rollup: invoice::Rollup,
}

/// `POST /me/owned/{owned_id}/documents/{doc_id}/parse` — owner-gated.
///
/// Two tiers, transparent to the caller:
///   - **Palier 1** (PDF text layer): parsed in-process, synchronously, here.
///   - **Palier 2** (image / scanned PDF, no text layer): queued for the GPU
///     worker (RapidOCR). The first call returns `note = "ocr_queued"`; the
///     `ocr_listener` later OCRs + parses + stores `parsed_metadata` and pushes
///     a `DocumentParsed` WS event, after which a repeat call returns the
///     suggestion in `extracted`.
///
/// NEVER writes `owned_items` — the SPA decides what (if anything) to apply.
async fn parse_document(
    State(state): State<AppState>,
    session: Session,
    Path((owned_id, doc_id)): Path<(Uuid, Uuid)>,
) -> AppResult<Json<ParseResponse>> {
    let user_id = auth::require_user(&session).await?;
    doc::assert_owned_by(&state.pool, user_id, owned_id).await?;
    let (storage_key, mime, parsed_metadata) =
        doc::find_doc_for_parse(&state.pool, user_id, owned_id, doc_id).await?;

    let mut extracted: Option<invoice::ParsedInvoice> = None;
    let mut note: Option<&'static str> = None;

    // 1. In-process text layer (Palier 1): a PDF with real text parses now.
    let mut text: Option<String> = None;
    if mime == "application/pdf" {
        let (bytes, _) = state.storage.get(&storage_key).await?;
        // pdf-extract is synchronous + CPU-bound → run it off the async runtime,
        // and bound concurrent parses so a burst of crafted PDFs can't exhaust
        // CPU / RSS on the memory-capped container.
        let _parse_permit = invoice::acquire_pdf_parse_permit().await;
        let extracted_text = tokio::task::spawn_blocking(move || invoice::extract_pdf_text(&bytes))
            .await
            .map_err(|e| AppError::Internal(anyhow::anyhow!("parse task panicked: {e}")))?;
        match extracted_text {
            Ok(t) if !t.trim().is_empty() => text = Some(t),
            Ok(_) => {} // image-only PDF → fall through to OCR
            Err(_) => note = Some("extract_failed"),
        }
    }

    if let Some(t) = text {
        let parsed = invoice::parse_invoice(&t);
        let meta = serde_json::to_value(&parsed).map_err(|e| AppError::Internal(e.into()))?;
        doc::set_parsed_metadata(&state.pool, user_id, doc_id, &meta).await?;
        extracted = Some(parsed);
    } else if note.is_none() {
        // No text layer. OCR (Palier 2) is reserved for a PDF that turned out to
        // be an image (a scanned invoice). Plain image uploads (JPG/PNG/WebP) are
        // NOT OCR'd — the parse feature is hidden for them client-side.
        if mime != "application/pdf" {
            note = Some("ocr_pdf_only");
        } else if let Some(meta) = parsed_metadata {
            // OCR already ran; the listener stored the suggestion.
            extracted = serde_json::from_value(meta).ok();
        } else {
            match ocr_job::latest_state_for_document(&state.pool, doc_id)
                .await?
                .as_deref()
            {
                // In flight (or just-ready, metadata about to land): keep waiting.
                Some("pending") | Some("processing") | Some("ready") => {
                    note = Some("ocr_pending")
                }
                // A prior job failed — surface it, don't silently re-queue (the
                // SPA's auto-refresh would otherwise loop).
                Some("failed") => note = Some("ocr_failed"),
                // Never queued → queue only if an OCR-capable worker is live;
                // otherwise the OCR feature is unavailable (disabled).
                _ => {
                    if worker::any_live_with_capability(&state.pool, "ocr").await? {
                        ocr_job::enqueue(
                            &state.pool,
                            doc_id,
                            owned_id,
                            user_id,
                            &storage_key,
                            &mime,
                        )
                        .await?;
                        note = Some("ocr_queued");
                    } else {
                        note = Some("ocr_unavailable");
                    }
                }
            }
        }
    }

    // Rollup across every parsed document on this item. Malformed/legacy blobs
    // are skipped, never fail the request.
    let metas = doc::list_parsed_metadata(&state.pool, owned_id).await?;
    let items: Vec<invoice::ParsedInvoice> = metas
        .into_iter()
        .filter_map(|v| serde_json::from_value(v).ok())
        .collect();
    let rollup = invoice::compute_rollup(&items);

    Ok(Json(ParseResponse {
        extracted,
        note,
        rollup,
    }))
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
        .route(
            "/me/owned/{owned_id}/documents/{doc_id}/parse",
            axum::routing::post(parse_document),
        )
}

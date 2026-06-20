//! OCR job queue (Palier 2) — image / scanned-PDF justificatifs handed to the
//! GPU worker (gsplat-worker, RapidOCR). The server only **enqueues** and reads
//! state; the worker claims rows (`FOR UPDATE SKIP LOCKED`), OCRs the blob, and
//! writes `result_text`. On the 'ready'/'failed' NOTIFY the `ocr_listener` runs
//! `parse_invoice` on the text and stores the suggestion as
//! `owned_item_documents.parsed_metadata`.

use crate::error::AppResult;
use sqlx::PgPool;
use uuid::Uuid;

/// Queue an OCR job for a document — a no-op when one is already
/// pending/processing (a second "Extraire" click must not pile up jobs).
/// Returns `true` when a new job was actually created.
pub async fn enqueue(
    pool: &PgPool,
    document_id: Uuid,
    owned_item_id: Uuid,
    user_id: Uuid,
    storage_key: &str,
    mime: &str,
) -> AppResult<bool> {
    let row: Option<(Uuid,)> = sqlx::query_as(
        "INSERT INTO document_ocr_jobs (document_id, owned_item_id, user_id, storage_key, mime)
         SELECT $1, $2, $3, $4, $5
         WHERE NOT EXISTS (
             SELECT 1 FROM document_ocr_jobs
              WHERE document_id = $1 AND state IN ('pending', 'processing')
         )
         RETURNING id",
    )
    .bind(document_id)
    .bind(owned_item_id)
    .bind(user_id)
    .bind(storage_key)
    .bind(mime)
    .fetch_optional(pool)
    .await?;
    Ok(row.is_some())
}

/// Most-recent job state for a document: "pending" | "processing" | "ready" |
/// "failed", or `None` if it was never queued. Lets the parse route report
/// "OCR en cours" vs "échec" vs "à lancer".
pub async fn latest_state_for_document(
    pool: &PgPool,
    document_id: Uuid,
) -> AppResult<Option<String>> {
    let row: Option<(String,)> = sqlx::query_as(
        "SELECT state FROM document_ocr_jobs
          WHERE document_id = $1
          ORDER BY created_at DESC
          LIMIT 1",
    )
    .bind(document_id)
    .fetch_optional(pool)
    .await?;
    Ok(row.map(|r| r.0))
}

/// The OCR text a finished job produced — read by the listener on a 'ready'
/// notify so it can run `parse_invoice` and store the suggestion.
pub async fn result_text_for_job(pool: &PgPool, job_id: Uuid) -> AppResult<Option<String>> {
    let row: Option<(Option<String>,)> =
        sqlx::query_as("SELECT result_text FROM document_ocr_jobs WHERE id = $1")
            .bind(job_id)
            .fetch_optional(pool)
            .await?;
    Ok(row.and_then(|r| r.0))
}

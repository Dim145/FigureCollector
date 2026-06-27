//! OCR job queue (Palier 2) — image / scanned-PDF justificatifs handed to the
//! GPU worker (gsplat-worker, RapidOCR). The server only **enqueues** and reads
//! state; the worker claims rows (`FOR UPDATE SKIP LOCKED`), OCRs the blob, and
//! writes `result_text`. On the 'ready'/'failed' NOTIFY the `ocr_listener` runs
//! `parse_invoice` on the text and stores the suggestion as
//! `owned_item_documents.parsed_metadata`.

use crate::error::AppResult;
use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::{FromRow, PgPool};
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

// =============================================================================
// Admin queue view — the OCR job queue surfaced to admins on the Tasks page,
// the same way `scan::admin_list` exposes the gsplat scan queue. Read-only:
// the GPU worker owns the rows (claim / process / write-back).
// =============================================================================

/// One row of the admin "Tasks" OCR view: a `document_ocr_jobs` row enriched
/// with the figurine it belongs to, its owner, and the worker that claimed it
/// (same join shape as [`crate::domain::scan::AdminScan`]).
#[derive(Debug, Clone, Serialize, FromRow)]
pub struct AdminOcrJob {
    pub id: Uuid,
    pub document_id: Uuid,
    pub owned_item_id: Uuid,
    pub user_id: Uuid,
    pub mime: String,
    pub state: String,
    pub error_message: Option<String>,
    pub attempts: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub claimed_at: Option<DateTime<Utc>>,
    pub finished_at: Option<DateTime<Utc>>,
    pub figure_id: Uuid,
    pub figure_name: String,
    pub figure_slug: String,
    pub owner_username: String,
    pub worker_id: Option<Uuid>,
    /// display_name when set, else hostname; `None` if no worker has claimed it.
    pub worker_name: Option<String>,
}

/// All OCR jobs, most-recent activity first, capped.
pub async fn admin_list(pool: &PgPool, limit: i64) -> AppResult<Vec<AdminOcrJob>> {
    let limit = limit.clamp(1, 500);
    Ok(sqlx::query_as::<_, AdminOcrJob>(
        "SELECT j.id, j.document_id, j.owned_item_id, j.user_id, j.mime, j.state,
                j.error_message, j.attempts, j.created_at, j.updated_at,
                j.claimed_at, j.finished_at,
                f.id AS figure_id, f.name AS figure_name, f.slug AS figure_slug,
                u.username AS owner_username,
                j.worker_id,
                COALESCE(w.display_name, w.hostname) AS worker_name
         FROM document_ocr_jobs j
         JOIN owned_items o ON o.id = j.owned_item_id
         JOIN figures f      ON f.id = o.figure_id
         JOIN users u        ON u.id = o.user_id
         LEFT JOIN workers w ON w.id = j.worker_id
         ORDER BY j.updated_at DESC
         LIMIT $1",
    )
    .bind(limit)
    .fetch_all(pool)
    .await?)
}

/// Delete one OCR job row outright (any state). Cancelling a still-claimed job
/// = deleting its row; if the GPU worker writes back later it just UPDATEs 0
/// rows, harmlessly. Returns the number of rows removed (0 if already gone).
pub async fn delete(pool: &PgPool, id: Uuid) -> AppResult<u64> {
    let res = sqlx::query("DELETE FROM document_ocr_jobs WHERE id = $1")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(res.rows_affected())
}

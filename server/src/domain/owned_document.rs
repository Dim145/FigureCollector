//! Private proof-of-purchase documents (receipts, invoices, customs slips)
//! attached to an owned item. Stored byte-for-byte in object storage; served
//! only to the owner.

use crate::error::{AppError, AppResult};
use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::{FromRow, PgPool};
use uuid::Uuid;

/// Row shape returned to the SPA (the `storage_key` stays server-side).
#[derive(Debug, Clone, Serialize, FromRow)]
pub struct OwnedDocument {
    pub id: Uuid,
    pub owned_item_id: Uuid,
    pub filename: String,
    pub mime: String,
    pub size_bytes: i64,
    /// Parsed-invoice metadata (Palier 1). `None` until the user runs
    /// "Extraire les infos" on this document; stored as JSONB.
    pub parsed_metadata: Option<serde_json::Value>,
    pub created_at: DateTime<Utc>,
}

/// Gate: the owned item must belong to `user_id` (used before list/upload).
pub async fn assert_owned_by(
    pool: &PgPool,
    user_id: Uuid,
    owned_item_id: Uuid,
) -> AppResult<()> {
    let row: Option<(Uuid,)> =
        sqlx::query_as("SELECT id FROM owned_items WHERE id = $1 AND user_id = $2")
            .bind(owned_item_id)
            .bind(user_id)
            .fetch_optional(pool)
            .await?;
    if row.is_none() {
        return Err(AppError::Forbidden);
    }
    Ok(())
}

pub async fn list(pool: &PgPool, owned_item_id: Uuid) -> AppResult<Vec<OwnedDocument>> {
    Ok(sqlx::query_as::<_, OwnedDocument>(
        "SELECT id, owned_item_id, filename, mime, size_bytes, parsed_metadata, created_at
         FROM owned_item_documents
         WHERE owned_item_id = $1
         ORDER BY created_at DESC",
    )
    .bind(owned_item_id)
    .fetch_all(pool)
    .await?)
}

#[allow(clippy::too_many_arguments)]
pub async fn create(
    pool: &PgPool,
    owned_item_id: Uuid,
    user_id: Uuid,
    storage_key: &str,
    filename: &str,
    mime: &str,
    size_bytes: i64,
) -> AppResult<OwnedDocument> {
    Ok(sqlx::query_as::<_, OwnedDocument>(
        "INSERT INTO owned_item_documents
            (owned_item_id, user_id, storage_key, filename, mime, size_bytes)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, owned_item_id, filename, mime, size_bytes, parsed_metadata, created_at",
    )
    .bind(owned_item_id)
    .bind(user_id)
    .bind(storage_key)
    .bind(filename)
    .bind(mime)
    .bind(size_bytes)
    .fetch_one(pool)
    .await?)
}

/// Private fetch for the serving proxy: returns `(storage_key, mime, filename)`
/// only if `user_id` owns the document.
pub async fn find_for_owner(
    pool: &PgPool,
    user_id: Uuid,
    doc_id: Uuid,
) -> AppResult<(String, String, String)> {
    sqlx::query_as::<_, (String, String, String)>(
        "SELECT storage_key, mime, filename
         FROM owned_item_documents
         WHERE id = $1 AND user_id = $2",
    )
    .bind(doc_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::NotFound)
}

/// Delete a document the user owns, returning its storage key for blob cleanup.
pub async fn delete_and_return_key(
    pool: &PgPool,
    user_id: Uuid,
    doc_id: Uuid,
) -> AppResult<String> {
    let row: Option<(String,)> = sqlx::query_as(
        "DELETE FROM owned_item_documents WHERE id = $1 AND user_id = $2 RETURNING storage_key",
    )
    .bind(doc_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await?;
    row.map(|r| r.0).ok_or(AppError::NotFound)
}

/// Blob lookup scoped to a specific item + owner — used by the parse route to
/// fetch the document bytes for text extraction.
pub async fn find_blob_in_item_for_owner(
    pool: &PgPool,
    user_id: Uuid,
    owned_item_id: Uuid,
    doc_id: Uuid,
) -> AppResult<(String, String)> {
    sqlx::query_as::<_, (String, String)>(
        "SELECT storage_key, mime
         FROM owned_item_documents
         WHERE id = $1 AND owned_item_id = $2 AND user_id = $3",
    )
    .bind(doc_id)
    .bind(owned_item_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::NotFound)
}

/// Persist the parsed-invoice metadata for a document the user owns.
pub async fn set_parsed_metadata(
    pool: &PgPool,
    user_id: Uuid,
    doc_id: Uuid,
    meta: &serde_json::Value,
) -> AppResult<()> {
    let res = sqlx::query(
        "UPDATE owned_item_documents
         SET parsed_metadata = $1::jsonb, parsed_at = now()
         WHERE id = $2 AND user_id = $3",
    )
    .bind(meta)
    .bind(doc_id)
    .bind(user_id)
    .execute(pool)
    .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    Ok(())
}

/// Every stored parsed-invoice blob for an item, oldest first — the input to
/// the cumulative rollup across deposit / balance / freight invoices.
pub async fn list_parsed_metadata(
    pool: &PgPool,
    owned_item_id: Uuid,
) -> AppResult<Vec<serde_json::Value>> {
    let rows: Vec<(serde_json::Value,)> = sqlx::query_as(
        "SELECT parsed_metadata
         FROM owned_item_documents
         WHERE owned_item_id = $1 AND parsed_metadata IS NOT NULL
         ORDER BY created_at ASC",
    )
    .bind(owned_item_id)
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(|r| r.0).collect())
}

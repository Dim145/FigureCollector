//! Photo repository — user-uploaded images of their owned figures.

use crate::error::{AppError, AppResult};
use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::{FromRow, PgPool};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct Photo {
    pub id: Uuid,
    pub owned_item_id: Uuid,
    pub storage_key: String,
    pub mime: String,
    pub width: i32,
    pub height: i32,
    pub size_bytes: i64,
    pub position: i32,
    /// WD-Tagger appearance tags (comma-separated), worker-written. `None` until
    /// the tagger has processed the photo; surfaced so the SPA can show chips.
    pub visual_tags: Option<String>,
    pub created_at: DateTime<Utc>,
}

pub async fn create(
    pool: &PgPool,
    owned_item_id: Uuid,
    storage_key: &str,
    mime: &str,
    width: i32,
    height: i32,
    size_bytes: i64,
) -> AppResult<Photo> {
    // Next position = max(position)+1 (or 0).
    let next_position: Option<(i32,)> = sqlx::query_as(
        "SELECT COALESCE(MAX(position) + 1, 0) FROM photos WHERE owned_item_id = $1",
    )
    .bind(owned_item_id)
    .fetch_optional(pool)
    .await?;
    let position = next_position.map(|(p,)| p).unwrap_or(0);

    let id = Uuid::now_v7();
    Ok(sqlx::query_as::<_, Photo>(
        "INSERT INTO photos (id, owned_item_id, storage_key, mime, width, height, size_bytes, position) \
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) \
         RETURNING id, owned_item_id, storage_key, mime, width, height, size_bytes, position, visual_tags, created_at",
    )
    .bind(id)
    .bind(owned_item_id)
    .bind(storage_key)
    .bind(mime)
    .bind(width)
    .bind(height)
    .bind(size_bytes)
    .bind(position)
    .fetch_one(pool)
    .await?)
}

pub async fn list_for_owned(pool: &PgPool, owned_item_id: Uuid) -> AppResult<Vec<Photo>> {
    Ok(sqlx::query_as::<_, Photo>(
        "SELECT id, owned_item_id, storage_key, mime, width, height, size_bytes, position, visual_tags, created_at
         FROM photos WHERE owned_item_id = $1 ORDER BY position ASC, created_at ASC",
    )
    .bind(owned_item_id)
    .fetch_all(pool)
    .await?)
}

pub async fn find_by_id(pool: &PgPool, id: Uuid) -> AppResult<Option<Photo>> {
    Ok(sqlx::query_as::<_, Photo>(
        "SELECT id, owned_item_id, storage_key, mime, width, height, size_bytes, position, visual_tags, created_at
         FROM photos WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?)
}

/// Delete the row and return the storage_key so the caller can drop the blob.
pub async fn delete_and_return_key(
    pool: &PgPool,
    user_id: Uuid,
    photo_id: Uuid,
) -> AppResult<String> {
    let row: Option<(String,)> = sqlx::query_as(
        "DELETE FROM photos
         WHERE id = $1
           AND owned_item_id IN (SELECT id FROM owned_items WHERE user_id = $2)
         RETURNING storage_key",
    )
    .bind(photo_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await?;
    row.map(|(k,)| k).ok_or(AppError::NotFound)
}

/// Edit-in-place: swap an existing photo's stored image while keeping its
/// `position` + `created_at`. Verifies the photo belongs to `user_id` and
/// returns the updated row plus the OLD storage_key so the caller can drop the
/// stale blob.
pub async fn replace_image(
    pool: &PgPool,
    user_id: Uuid,
    photo_id: Uuid,
    storage_key: &str,
    mime: &str,
    width: i32,
    height: i32,
    size_bytes: i64,
) -> AppResult<(Photo, String)> {
    let existing = find_by_id(pool, photo_id).await?.ok_or(AppError::NotFound)?;
    assert_owned_by(pool, user_id, existing.owned_item_id).await?;
    let updated = sqlx::query_as::<_, Photo>(
        "UPDATE photos SET storage_key = $1, mime = $2, width = $3, height = $4, size_bytes = $5, \
            visual_tags = NULL \
         WHERE id = $6 \
         RETURNING id, owned_item_id, storage_key, mime, width, height, size_bytes, position, visual_tags, created_at",
    )
    .bind(storage_key)
    .bind(mime)
    .bind(width)
    .bind(height)
    .bind(size_bytes)
    .bind(photo_id)
    .fetch_one(pool)
    .await?;
    Ok((updated, existing.storage_key))
}

/// Check that `owned_item_id` belongs to `user_id`.
pub async fn assert_owned_by(pool: &PgPool, user_id: Uuid, owned_item_id: Uuid) -> AppResult<()> {
    let row: Option<(Uuid,)> =
        sqlx::query_as("SELECT id FROM owned_items WHERE id = $1 AND user_id = $2")
            .bind(owned_item_id)
            .bind(user_id)
            .fetch_optional(pool)
            .await?;
    if row.is_none() {
        return Err(AppError::NotFound);
    }
    Ok(())
}

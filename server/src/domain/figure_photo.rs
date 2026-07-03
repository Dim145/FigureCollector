//! Catalog-side photos for a figure. Shared across all users; uploaded by
//! the figure's creator or any admin. Distinct from `domain::photo`, which
//! holds per-user pictures of *their* copy of the figurine.

use crate::error::{AppError, AppResult};
use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::{Acquire, FromRow, PgPool};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct FigurePhoto {
    pub id: Uuid,
    pub figure_id: Uuid,
    pub storage_key: String,
    pub mime: String,
    pub width: i32,
    pub height: i32,
    pub size_bytes: i64,
    pub position: i32,
    pub uploaded_by: Option<Uuid>,
    pub is_primary: bool,
    pub created_at: DateTime<Utc>,
}

pub async fn list(pool: &PgPool, figure_id: Uuid) -> AppResult<Vec<FigurePhoto>> {
    Ok(sqlx::query_as::<_, FigurePhoto>(
        "SELECT id, figure_id, storage_key, mime, width, height, size_bytes,
                position, uploaded_by, is_primary, created_at
         FROM figure_photos WHERE figure_id = $1
         ORDER BY is_primary DESC, position ASC, created_at ASC",
    )
    .bind(figure_id)
    .fetch_all(pool)
    .await?)
}

pub async fn find_by_id(pool: &PgPool, id: Uuid) -> AppResult<Option<FigurePhoto>> {
    Ok(sqlx::query_as::<_, FigurePhoto>(
        "SELECT id, figure_id, storage_key, mime, width, height, size_bytes,
                position, uploaded_by, is_primary, created_at
         FROM figure_photos WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?)
}

/// Insert a new figure photo. Becomes `is_primary = true` automatically if
/// it's the first one for the figure.
pub async fn create(
    pool: &PgPool,
    figure_id: Uuid,
    storage_key: &str,
    mime: &str,
    width: i32,
    height: i32,
    size_bytes: i64,
    uploaded_by: Uuid,
) -> AppResult<FigurePhoto> {
    let mut tx = pool.begin().await?;

    let (count,): (i64,) =
        sqlx::query_as("SELECT COUNT(*)::bigint FROM figure_photos WHERE figure_id = $1")
            .bind(figure_id)
            .fetch_one(&mut *tx)
            .await?;
    let is_primary = count == 0;

    let next_position: Option<(i32,)> = sqlx::query_as(
        "SELECT COALESCE(MAX(position) + 1, 0) FROM figure_photos WHERE figure_id = $1",
    )
    .bind(figure_id)
    .fetch_optional(&mut *tx)
    .await?;
    let position = next_position.map(|(p,)| p).unwrap_or(0);

    let id = Uuid::now_v7();
    let insert_sql = "INSERT INTO figure_photos (
            id, figure_id, storage_key, mime, width, height, size_bytes,
            position, uploaded_by, is_primary
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         RETURNING id, figure_id, storage_key, mime, width, height, size_bytes,
                   position, uploaded_by, is_primary, created_at";

    // First-upload race: two concurrent uploads to a figure with 0 photos both
    // compute is_primary=TRUE and collide on the `figure_photos_primary_idx`
    // partial-unique index. Attempt the insert inside a savepoint (nested tx) so
    // a unique violation rolls back only this statement — leaving the outer tx
    // usable — then retry once as a non-primary photo with a recomputed position.
    let mut sp = tx.begin().await?;
    let attempt = sqlx::query_as::<_, FigurePhoto>(insert_sql)
        .bind(id)
        .bind(figure_id)
        .bind(storage_key)
        .bind(mime)
        .bind(width)
        .bind(height)
        .bind(size_bytes)
        .bind(position)
        .bind(uploaded_by)
        .bind(is_primary)
        .fetch_one(&mut *sp)
        .await;
    let row: FigurePhoto = match attempt {
        Ok(row) => {
            sp.commit().await?;
            row
        }
        Err(sqlx::Error::Database(db)) if is_primary && db.is_unique_violation() => {
            sp.rollback().await?;
            let (position,): (i32,) = sqlx::query_as(
                "SELECT COALESCE(MAX(position) + 1, 0) FROM figure_photos WHERE figure_id = $1",
            )
            .bind(figure_id)
            .fetch_one(&mut *tx)
            .await?;
            sqlx::query_as::<_, FigurePhoto>(insert_sql)
                .bind(id)
                .bind(figure_id)
                .bind(storage_key)
                .bind(mime)
                .bind(width)
                .bind(height)
                .bind(size_bytes)
                .bind(position)
                .bind(uploaded_by)
                .bind(false)
                .fetch_one(&mut *tx)
                .await?
        }
        Err(e) => {
            sp.rollback().await?;
            return Err(e.into());
        }
    };

    tx.commit().await?;
    Ok(row)
}

/// Mark a specific photo as the figure's primary. Idempotent — if it's
/// already primary nothing changes.
pub async fn set_primary(pool: &PgPool, figure_id: Uuid, photo_id: Uuid) -> AppResult<()> {
    let mut tx = pool.begin().await?;

    // Confirm the photo belongs to the figure.
    let exists: Option<(Uuid,)> = sqlx::query_as(
        "SELECT id FROM figure_photos WHERE id = $1 AND figure_id = $2",
    )
    .bind(photo_id)
    .bind(figure_id)
    .fetch_optional(&mut *tx)
    .await?;
    if exists.is_none() {
        return Err(AppError::NotFound);
    }

    // Clear any current primary first — the partial unique index would
    // otherwise reject a two-row update.
    sqlx::query("UPDATE figure_photos SET is_primary = FALSE WHERE figure_id = $1 AND is_primary")
        .bind(figure_id)
        .execute(&mut *tx)
        .await?;

    sqlx::query("UPDATE figure_photos SET is_primary = TRUE WHERE id = $1")
        .bind(photo_id)
        .execute(&mut *tx)
        .await?;

    tx.commit().await?;
    Ok(())
}

/// Delete the row, return the storage_key so the caller can drop the blob.
/// If the deleted row was the primary, the next-lowest-position remaining
/// photo (if any) is promoted to primary so the figure always shows the
/// best available cover.
pub async fn delete_and_return_key(
    pool: &PgPool,
    figure_id: Uuid,
    photo_id: Uuid,
) -> AppResult<String> {
    let mut tx = pool.begin().await?;

    let row: Option<(String, bool)> = sqlx::query_as(
        "DELETE FROM figure_photos WHERE id = $1 AND figure_id = $2
         RETURNING storage_key, is_primary",
    )
    .bind(photo_id)
    .bind(figure_id)
    .fetch_optional(&mut *tx)
    .await?;

    let (storage_key, was_primary) = row.ok_or(AppError::NotFound)?;

    if was_primary {
        // Promote the next remaining photo (by position) to primary.
        sqlx::query(
            "UPDATE figure_photos SET is_primary = TRUE
             WHERE id = (
                 SELECT id FROM figure_photos
                 WHERE figure_id = $1
                 ORDER BY position ASC, created_at ASC
                 LIMIT 1
             )",
        )
        .bind(figure_id)
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;
    Ok(storage_key)
}

/// Edit-in-place: swap a catalog photo's stored image while keeping its
/// `position`, `is_primary` and `created_at`. The caller has already
/// authorised (admin / creator) and resolved the figure. Returns the updated
/// row plus the OLD storage_key so the caller can drop the stale blob.
pub async fn replace_image(
    pool: &PgPool,
    figure_id: Uuid,
    photo_id: Uuid,
    storage_key: &str,
    mime: &str,
    width: i32,
    height: i32,
    size_bytes: i64,
) -> AppResult<(FigurePhoto, String)> {
    let existing = find_by_id(pool, photo_id).await?.ok_or(AppError::NotFound)?;
    if existing.figure_id != figure_id {
        return Err(AppError::NotFound);
    }
    let updated = sqlx::query_as::<_, FigurePhoto>(
        "UPDATE figure_photos SET storage_key = $1, mime = $2, width = $3, height = $4, size_bytes = $5 \
         WHERE id = $6 AND figure_id = $7 \
         RETURNING id, figure_id, storage_key, mime, width, height, size_bytes, position, uploaded_by, is_primary, created_at",
    )
    .bind(storage_key)
    .bind(mime)
    .bind(width)
    .bind(height)
    .bind(size_bytes)
    .bind(photo_id)
    .bind(figure_id)
    .fetch_one(pool)
    .await?;
    Ok((updated, existing.storage_key))
}

/// Returns `(storage_key, is_primary)` for the figure's primary photo, if
/// any. Used by the owned-items list to resolve a fallback cover.
#[allow(dead_code)]
pub async fn primary_for(
    pool: &PgPool,
    figure_id: Uuid,
) -> AppResult<Option<(Uuid, String)>> {
    let row: Option<(Uuid, String)> = sqlx::query_as(
        "SELECT id, storage_key FROM figure_photos
         WHERE figure_id = $1
         ORDER BY is_primary DESC, position ASC, created_at ASC
         LIMIT 1",
    )
    .bind(figure_id)
    .fetch_optional(pool)
    .await?;
    Ok(row)
}

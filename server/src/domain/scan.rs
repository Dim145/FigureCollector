//! Scan repository — a "scan" groups N image frames stored under a shared
//! Garage prefix. Phase 5A produces `kind = 'turntable'` scans; Phase 5B will
//! reuse the row to store the result of a Gaussian-Splatting training job.

use crate::error::{AppError, AppResult};
use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::{FromRow, PgPool};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct Scan {
    pub id: Uuid,
    pub owned_item_id: Uuid,
    pub kind: String,
    pub state: String,
    pub storage_prefix: String,
    pub frame_count: i32,
    pub result_key: Option<String>,
    pub error_message: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

pub const ALLOWED_KINDS: &[&str] = &["turntable", "gsplat"];

pub async fn create(
    pool: &PgPool,
    owned_item_id: Uuid,
    kind: &str,
    storage_prefix: &str,
    initial_state: &str,
) -> AppResult<Scan> {
    if !ALLOWED_KINDS.contains(&kind) {
        return Err(AppError::BadRequest("invalid scan kind"));
    }
    let id = Uuid::now_v7();
    Ok(sqlx::query_as::<_, Scan>(
        "INSERT INTO scans (id, owned_item_id, kind, state, storage_prefix)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, owned_item_id, kind, state, storage_prefix, frame_count,
                   result_key, error_message, created_at, updated_at",
    )
    .bind(id)
    .bind(owned_item_id)
    .bind(kind)
    .bind(initial_state)
    .bind(storage_prefix)
    .fetch_one(pool)
    .await?)
}

pub async fn set_frame_count(pool: &PgPool, scan_id: Uuid, count: i32) -> AppResult<()> {
    sqlx::query("UPDATE scans SET frame_count = $1, state = 'ready' WHERE id = $2")
        .bind(count)
        .bind(scan_id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn mark_failed(pool: &PgPool, scan_id: Uuid, error: &str) -> AppResult<()> {
    sqlx::query("UPDATE scans SET state = 'failed', error_message = $1 WHERE id = $2")
        .bind(error)
        .bind(scan_id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn list_for_owned(pool: &PgPool, owned_item_id: Uuid) -> AppResult<Vec<Scan>> {
    Ok(sqlx::query_as::<_, Scan>(
        "SELECT id, owned_item_id, kind, state, storage_prefix, frame_count,
                result_key, error_message, created_at, updated_at
         FROM scans
         WHERE owned_item_id = $1
         ORDER BY created_at DESC",
    )
    .bind(owned_item_id)
    .fetch_all(pool)
    .await?)
}

pub async fn find_by_id(pool: &PgPool, id: Uuid) -> AppResult<Option<Scan>> {
    Ok(sqlx::query_as::<_, Scan>(
        "SELECT id, owned_item_id, kind, state, storage_prefix, frame_count,
                result_key, error_message, created_at, updated_at
         FROM scans WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?)
}

pub async fn delete_for_user(pool: &PgPool, user_id: Uuid, scan_id: Uuid) -> AppResult<String> {
    let row: Option<(String,)> = sqlx::query_as(
        "DELETE FROM scans
         WHERE id = $1
           AND owned_item_id IN (SELECT id FROM owned_items WHERE user_id = $2)
         RETURNING storage_prefix",
    )
    .bind(scan_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await?;
    row.map(|(p,)| p).ok_or(AppError::NotFound)
}

/// Authorise the viewer: owner OR (owner has public profile + scan is ready).
pub async fn assert_visible(pool: &PgPool, viewer: Option<Uuid>, scan: &Scan) -> AppResult<()> {
    let owner: Option<(Uuid, bool)> = sqlx::query_as(
        "SELECT u.id, u.public_profile_enabled
         FROM owned_items o JOIN users u ON u.id = o.user_id
         WHERE o.id = $1",
    )
    .bind(scan.owned_item_id)
    .fetch_optional(pool)
    .await?;
    let Some((owner_id, is_public)) = owner else {
        return Err(AppError::NotFound);
    };
    if viewer == Some(owner_id) {
        return Ok(());
    }
    if is_public && scan.state == "ready" {
        return Ok(());
    }
    Err(AppError::Forbidden)
}

/// Confirm the owned_item belongs to user_id.
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

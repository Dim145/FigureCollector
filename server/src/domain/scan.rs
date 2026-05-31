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
    /// Worker-reported training progress 0–100 (gsplat), null when N/A.
    pub progress: Option<i16>,
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
                   result_key, error_message, progress, created_at, updated_at",
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
    // Turntable scans are done the moment their frames land, so they go
    // straight to 'ready'. gsplat scans, however, are only *captured* here —
    // the splat worker still has to train + export — so they must stay in
    // whatever state they were created with ('pending'). Clobbering that to
    // 'ready' (as this used to) meant the worker's `WHERE state='pending'`
    // never matched and no gsplat job was ever picked up.
    sqlx::query(
        "UPDATE scans
            SET frame_count = $1,
                state = CASE WHEN kind = 'gsplat' THEN state ELSE 'ready' END
          WHERE id = $2",
    )
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

/// Make a gsplat scan claimable by the worker. Called only after every asset
/// (frames and/or the source video) has finished uploading to Garage, so the
/// worker can't grab a half-uploaded scan.
pub async fn mark_pending(pool: &PgPool, scan_id: Uuid) -> AppResult<()> {
    sqlx::query("UPDATE scans SET state = 'pending', updated_at = now() WHERE id = $1")
        .bind(scan_id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn list_for_owned(pool: &PgPool, owned_item_id: Uuid) -> AppResult<Vec<Scan>> {
    Ok(sqlx::query_as::<_, Scan>(
        "SELECT id, owned_item_id, kind, state, storage_prefix, frame_count,
                result_key, error_message, progress, created_at, updated_at
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
                result_key, error_message, progress, created_at, updated_at
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
    let owner: Option<(Uuid, bool, bool, bool)> = sqlx::query_as(
        "SELECT u.id, u.public_profile_enabled, u.public_profile_show_nsfw, f.is_nsfw
         FROM owned_items o
         JOIN users u ON u.id = o.user_id
         JOIN figures f ON f.id = o.figure_id
         WHERE o.id = $1",
    )
    .bind(scan.owned_item_id)
    .fetch_optional(pool)
    .await?;
    let Some((owner_id, is_public, show_nsfw, is_nsfw)) = owner else {
        return Err(AppError::NotFound);
    };
    if viewer == Some(owner_id) {
        return Ok(());
    }
    // Non-owner: public profile, scan finished, and either the owner shares
    // NSFW or the underlying piece isn't NSFW.
    if is_public && scan.state == "ready" && (show_nsfw || !is_nsfw) {
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

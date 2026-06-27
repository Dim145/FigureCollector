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

// =============================================================================
// Admin queue management (Lot 9) — the gsplat task queue surfaced to admins.
// Every function here is scoped to `kind = 'gsplat'`; turntables are user
// content (no worker), never touched.
// =============================================================================

/// One row of the admin "Tasks" view: a gsplat scan enriched with the figurine
/// it belongs to, its owner, and the worker that claimed it.
#[derive(Debug, Clone, Serialize, FromRow)]
pub struct AdminScan {
    pub id: Uuid,
    pub owned_item_id: Uuid,
    pub state: String,
    pub frame_count: i32,
    pub result_key: Option<String>,
    pub error_message: Option<String>,
    pub progress: Option<i16>,
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

/// All gsplat tasks, most-recent activity first, capped.
pub async fn admin_list(pool: &PgPool, limit: i64) -> AppResult<Vec<AdminScan>> {
    let limit = limit.clamp(1, 500);
    Ok(sqlx::query_as::<_, AdminScan>(
        "SELECT s.id, s.owned_item_id, s.state, s.frame_count, s.result_key,
                s.error_message, s.progress, s.attempts, s.created_at, s.updated_at,
                s.claimed_at, s.finished_at,
                f.id AS figure_id, f.name AS figure_name, f.slug AS figure_slug,
                u.username AS owner_username,
                s.worker_id,
                COALESCE(w.display_name, w.hostname) AS worker_name
         FROM scans s
         JOIN owned_items o ON o.id = s.owned_item_id
         JOIN figures f      ON f.id = o.figure_id
         JOIN users u        ON u.id = o.user_id
         LEFT JOIN workers w ON w.id = s.worker_id
         WHERE s.kind = 'gsplat'
         ORDER BY s.updated_at DESC
         LIMIT $1",
    )
    .bind(limit)
    .fetch_all(pool)
    .await?)
}

/// Re-queue a FAILED task: back to `pending`, ownership + failure cleared.
pub async fn admin_retry(pool: &PgPool, id: Uuid) -> AppResult<()> {
    let res = sqlx::query(
        "UPDATE scans
            SET state='pending', worker_id=NULL, claimed_at=NULL, finished_at=NULL,
                error_message=NULL, progress=NULL, updated_at=now()
          WHERE id=$1 AND kind='gsplat' AND state='failed'",
    )
    .bind(id)
    .execute(pool)
    .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::BadRequest("not a failed gsplat task"));
    }
    Ok(())
}

/// Force a non-terminal task (pending/processing) to `failed` — the manual
/// escape hatch for a wedged job. If a worker is still on it, its later
/// completion may overwrite this; that's acceptable (the admin gave up on it).
pub async fn admin_mark_failed(pool: &PgPool, id: Uuid) -> AppResult<()> {
    let res = sqlx::query(
        "UPDATE scans
            SET state='failed', finished_at=now(),
                error_message=COALESCE(NULLIF(error_message, ''),
                                       'Marquée comme échouée par un administrateur'),
                updated_at=now()
          WHERE id=$1 AND kind='gsplat' AND state IN ('pending','processing')",
    )
    .bind(id)
    .execute(pool)
    .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::BadRequest("task is not pending or processing"));
    }
    Ok(())
}

/// Delete a task row outright; returns `(storage_prefix, result_key)` so the
/// caller can purge the Garage blobs. Allowed in ANY state — the admin console
/// uses this both to remove a terminal run and to "cancel" a running one:
/// dropping the row is enough; if the worker later writes to the (now absent)
/// row it simply updates 0 rows (harmless).
pub async fn admin_delete(pool: &PgPool, id: Uuid) -> AppResult<(String, Option<String>)> {
    sqlx::query_as::<_, (String, Option<String>)>(
        "DELETE FROM scans
          WHERE id=$1 AND kind='gsplat'
        RETURNING storage_prefix, result_key",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::NotFound)
}

/// Auto-cleanup: keep the `keep` most-recent SUCCESSFUL gsplat scans PER
/// owned_item, delete the rest. Returns their `(storage_prefix, result_key)`
/// for Garage purge. Never touches turntables, failures, or in-flight jobs —
/// so a figurine never loses its only model, just stale re-scans.
pub async fn cleanup_completed(pool: &PgPool, keep: i64) -> AppResult<Vec<(String, Option<String>)>> {
    let keep = keep.max(1);
    Ok(sqlx::query_as::<_, (String, Option<String>)>(
        "WITH ranked AS (
            SELECT id, storage_prefix, result_key,
                   ROW_NUMBER() OVER (
                       PARTITION BY owned_item_id
                       ORDER BY finished_at DESC NULLS LAST, created_at DESC
                   ) AS rn
            FROM scans
            WHERE kind='gsplat' AND state='ready'
         )
         DELETE FROM scans
          WHERE id IN (SELECT id FROM ranked WHERE rn > $1)
        RETURNING storage_prefix, result_key",
    )
    .bind(keep)
    .fetch_all(pool)
    .await?)
}

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
    let owner: Option<(Uuid, bool, bool, bool, bool)> = sqlx::query_as(
        "SELECT u.id, u.public_profile_enabled, u.public_profile_show_nsfw, f.is_nsfw,
                COALESCE(o.cover_scan_id = $2, FALSE) AS is_cover
         FROM owned_items o
         JOIN users u ON u.id = o.user_id
         JOIN figures f ON f.id = o.figure_id
         WHERE o.id = $1",
    )
    .bind(scan.owned_item_id)
    .bind(scan.id)
    .fetch_optional(pool)
    .await?;
    let Some((owner_id, is_public, show_nsfw, is_nsfw, is_cover)) = owner else {
        return Err(AppError::NotFound);
    };
    if viewer == Some(owner_id) {
        return Ok(());
    }
    // Non-owner: public profile, scan finished, not-NSFW (or shared), AND this
    // scan is the piece's pinned cover — the only scan a public surface shows
    // (the cover thumbnail). Other/old scans stay private to the owner.
    if is_public && scan.state == "ready" && (show_nsfw || !is_nsfw) && is_cover {
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

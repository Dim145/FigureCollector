//! Worker registry — every gsplat worker (CUDA + macOS Metal) self-registers
//! here on startup and heartbeats periodically. The admin UI reads from this
//! table to show who's online, who's disabled, and to gate "Generate 3D" on
//! the upload form (`any_live` below).
//!
//! Liveness model:
//!   * worker reports its `heartbeat_interval_secs`
//!   * worker UPSERTs on startup, UPDATEs `last_seen` every tick
//!   * backend considers a worker live when
//!       `last_seen > now() - interval * OFFLINE_MISS_THRESHOLD`
//!     (i.e. after 3 missed heartbeats it goes offline). The 3 lives here,
//!     in code — workers don't need to know it.
//!
//! Disable vs delete:
//!   * `enabled = false` → the worker stops claiming jobs (it polls this
//!     column every tick) but stays in the table so the admin can re-enable.
//!   * delete is only allowed when the worker isn't BOTH enabled AND online
//!     — i.e. you can wipe a stale/disabled row, but not yank an active one.

use crate::error::{AppError, AppResult};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, PgPool};
use uuid::Uuid;

/// Workers go offline after N missed heartbeats. Higher = more tolerant of
/// blips; lower = faster reaction to a dead worker.
pub const OFFLINE_MISS_THRESHOLD: i32 = 3;

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct Worker {
    pub id: Uuid,
    pub hostname: String,
    pub display_name: Option<String>,
    pub kind: String,
    pub os: String,
    pub arch: String,
    pub gpu: Option<String>,
    pub gpu_memory_mb: Option<i32>,
    pub runtime_version: Option<String>,
    pub worker_version: Option<String>,
    pub heartbeat_interval_secs: i32,
    pub last_seen: DateTime<Utc>,
    pub enabled: bool,
    pub registered_at: DateTime<Utc>,
}

/// Wire shape for the admin list — adds the computed `online` flag and the
/// `effective_name` (display_name when set, else hostname) so the SPA
/// doesn't have to recompute either.
#[derive(Debug, Clone, Serialize)]
pub struct WorkerView {
    #[serde(flatten)]
    pub worker: Worker,
    pub online: bool,
    pub effective_name: String,
}

impl WorkerView {
    pub fn from(worker: Worker) -> Self {
        let online = is_live(&worker);
        let effective_name = worker
            .display_name
            .clone()
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| worker.hostname.clone());
        Self {
            worker,
            online,
            effective_name,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct WorkerPatch {
    pub display_name: Option<Option<String>>,
    pub enabled: Option<bool>,
}

fn is_live(w: &Worker) -> bool {
    let max_silence_secs = i64::from(w.heartbeat_interval_secs * OFFLINE_MISS_THRESHOLD);
    let elapsed = Utc::now().signed_duration_since(w.last_seen).num_seconds();
    elapsed <= max_silence_secs
}

pub async fn list(pool: &PgPool) -> AppResult<Vec<WorkerView>> {
    let rows = sqlx::query_as::<_, Worker>(
        "SELECT id, hostname, display_name, kind, os, arch, gpu, gpu_memory_mb,
                runtime_version, worker_version, heartbeat_interval_secs,
                last_seen, enabled, registered_at
         FROM workers
         ORDER BY enabled DESC, last_seen DESC, hostname ASC",
    )
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(WorkerView::from).collect())
}

pub async fn find_by_id(pool: &PgPool, id: Uuid) -> AppResult<Option<Worker>> {
    Ok(sqlx::query_as::<_, Worker>(
        "SELECT id, hostname, display_name, kind, os, arch, gpu, gpu_memory_mb,
                runtime_version, worker_version, heartbeat_interval_secs,
                last_seen, enabled, registered_at
         FROM workers WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?)
}

pub async fn patch(pool: &PgPool, id: Uuid, input: WorkerPatch) -> AppResult<WorkerView> {
    // `display_name` is `Option<Option<String>>` so the caller can
    // distinguish "leave alone" (None) from "clear" (Some(None)) from
    // "set" (Some(Some(value))). We only touch it when present.
    let touch_name = input.display_name.is_some();
    let new_name = input.display_name.unwrap_or(None);
    let row: Option<Worker> = sqlx::query_as(
        "UPDATE workers SET
            display_name = CASE WHEN $1 THEN $2 ELSE display_name END,
            enabled      = COALESCE($3, enabled)
         WHERE id = $4
         RETURNING id, hostname, display_name, kind, os, arch, gpu, gpu_memory_mb,
                   runtime_version, worker_version, heartbeat_interval_secs,
                   last_seen, enabled, registered_at",
    )
    .bind(touch_name)
    .bind(new_name.as_ref().map(|s| s.trim().to_string()).filter(|s| !s.is_empty()))
    .bind(input.enabled)
    .bind(id)
    .fetch_optional(pool)
    .await?;
    row.map(WorkerView::from).ok_or(AppError::NotFound)
}

/// Delete a worker — only when it's NOT currently enabled+online (otherwise
/// the admin would be yanking an active processor from under itself, and
/// the worker would re-register on its next heartbeat anyway). Returns
/// `Conflict` so the SPA can show a meaningful message.
pub async fn delete(pool: &PgPool, id: Uuid) -> AppResult<()> {
    let row = find_by_id(pool, id).await?.ok_or(AppError::NotFound)?;
    if row.enabled && is_live(&row) {
        return Err(AppError::Conflict(
            "cannot delete an enabled + online worker; disable it first",
        ));
    }
    let res = sqlx::query("DELETE FROM workers WHERE id = $1")
        .bind(id)
        .execute(pool)
        .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    Ok(())
}

/// Capability probe used by the scan-creation route and the SPA's "Generate
/// 3D" checkbox: is there at least one worker registered, enabled, AND
/// alive enough to claim the job?
pub async fn any_live(pool: &PgPool) -> AppResult<bool> {
    let row: (bool,) = sqlx::query_as(
        "SELECT EXISTS (
             SELECT 1 FROM workers
             WHERE enabled = TRUE
               AND last_seen > NOW()
                  - make_interval(secs => heartbeat_interval_secs * $1)
         )",
    )
    .bind(OFFLINE_MISS_THRESHOLD)
    .fetch_one(pool)
    .await?;
    Ok(row.0)
}

// Worker → DB write paths (UPSERT on startup, heartbeat tick) run inline
// from the Python workers via asyncpg — same pattern as how they already
// `claim_next_pending` directly against the DB. Keeping the schema in one
// place (this file + the migration) avoids drift; if we ever add an HTTP
// register endpoint, the contract is already documented in `Worker` /
// `WorkerView`.

//! History of the server's own background-job runs (`server_job_runs`).
//!
//! Every sweep of an in-process cron (release cron, scan cleanup, manga sync,
//! price cron) is recorded here by [`crate::services::job_runner`] — state,
//! trigger, result summary (JSONB) and error — so the admin Tasks page can
//! list server tasks next to the worker scan queue and relaunch failures.
//! States reuse the scans vocabulary (`processing` / `ready` / `failed`).

use crate::error::AppResult;
use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::{FromRow, PgPool};
use uuid::Uuid;

/// Runs kept per job — older ones are pruned when a new run starts. Bounds the
/// table whatever the cadence (the hourly cleanup would otherwise pile up).
const KEEP_PER_JOB: i64 = 30;

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct ServerJobRun {
    pub id: Uuid,
    pub job_name: String,
    /// `schedule` (the cron loop) or `manual` (admin relaunch).
    pub triggered_by: String,
    /// `processing` | `ready` | `failed` — same vocabulary as scans.
    pub state: String,
    /// Job-specific summary, e.g. `{"processed": 127, "updated": 42}`.
    pub result: Option<serde_json::Value>,
    pub error_message: Option<String>,
    pub started_at: DateTime<Utc>,
    pub finished_at: Option<DateTime<Utc>>,
}

/// Record the start of a run. Returns `None` when the same job already has a
/// run in flight (single-flight guard — sweeps are idempotent but overlapping
/// them wastes upstream calls). Also prunes that job's history to
/// [`KEEP_PER_JOB`] rows.
pub async fn start(pool: &PgPool, job_name: &str, triggered_by: &str) -> AppResult<Option<Uuid>> {
    let running: Option<Uuid> = sqlx::query_scalar(
        "SELECT id FROM server_job_runs WHERE job_name = $1 AND state = 'processing' LIMIT 1",
    )
    .bind(job_name)
    .fetch_optional(pool)
    .await?;
    if running.is_some() {
        return Ok(None);
    }

    sqlx::query(
        "DELETE FROM server_job_runs
         WHERE job_name = $1 AND id NOT IN (
             SELECT id FROM server_job_runs
             WHERE job_name = $1
             ORDER BY started_at DESC
             LIMIT $2
         )",
    )
    .bind(job_name)
    .bind(KEEP_PER_JOB - 1)
    .execute(pool)
    .await?;

    let id: Uuid = sqlx::query_scalar(
        "INSERT INTO server_job_runs (job_name, triggered_by) VALUES ($1, $2) RETURNING id",
    )
    .bind(job_name)
    .bind(triggered_by)
    .fetch_one(pool)
    .await?;
    Ok(Some(id))
}

pub async fn finish_ok(pool: &PgPool, id: Uuid, result: &serde_json::Value) -> AppResult<()> {
    sqlx::query(
        "UPDATE server_job_runs
         SET state = 'ready', result = $2, finished_at = now()
         WHERE id = $1",
    )
    .bind(id)
    .bind(result)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn finish_failed(pool: &PgPool, id: Uuid, error: &str) -> AppResult<()> {
    sqlx::query(
        "UPDATE server_job_runs
         SET state = 'failed', error_message = $2, finished_at = now()
         WHERE id = $1",
    )
    .bind(id)
    .bind(error)
    .execute(pool)
    .await?;
    Ok(())
}

/// Recent runs across all jobs, most recent first.
pub async fn list(pool: &PgPool, limit: i64) -> AppResult<Vec<ServerJobRun>> {
    let limit = limit.clamp(1, 500);
    Ok(sqlx::query_as::<_, ServerJobRun>(
        "SELECT id, job_name, triggered_by, state, result, error_message,
                started_at, finished_at
         FROM server_job_runs
         ORDER BY started_at DESC
         LIMIT $1",
    )
    .bind(limit)
    .fetch_all(pool)
    .await?)
}

pub async fn get(pool: &PgPool, id: Uuid) -> AppResult<Option<ServerJobRun>> {
    Ok(sqlx::query_as::<_, ServerJobRun>(
        "SELECT id, job_name, triggered_by, state, result, error_message,
                started_at, finished_at
         FROM server_job_runs
         WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?)
}

/// Close runs orphaned by a process death: anything still `processing` when
/// the server boots was interrupted mid-run. Called once at startup so the
/// admin Tasks page never shows ghost in-flight runs.
///
/// Reindex jobs (`reindex_*`) are EXEMPT: their work runs in the external embed
/// worker, not in this process, so a server restart doesn't interrupt them — the
/// reconciler closes them once the queue drains.
pub async fn mark_interrupted(pool: &PgPool) -> AppResult<u64> {
    let res = sqlx::query(
        "UPDATE server_job_runs
         SET state = 'failed',
             error_message = 'interrupted by a server restart',
             finished_at = now()
         WHERE state = 'processing'
           AND job_name NOT LIKE 'reindex\\_%' ESCAPE '\\'",
    )
    .execute(pool)
    .await?;
    Ok(res.rows_affected())
}

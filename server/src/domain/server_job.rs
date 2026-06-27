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
const KEEP_PER_JOB: i64 = 100;

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
    /// Generic "items changed/affected" count. `0` ⇒ a no-op run (the console
    /// can hide these); `NULL` ⇒ legacy/unknown ⇒ never hidden.
    pub changed: Option<i64>,
    /// The admin who launched a `manual` run (NULL for scheduled ticks or when
    /// that user has since been deleted — the FK is `ON DELETE SET NULL`).
    pub triggered_by_user: Option<Uuid>,
    /// Username of `triggered_by_user`, resolved via a LEFT JOIN on `users`.
    /// `None` for scheduled runs or a deleted/unknown actor.
    pub triggered_by_username: Option<String>,
    pub started_at: DateTime<Utc>,
    pub finished_at: Option<DateTime<Utc>>,
}

/// Record the start of a run. Returns `None` when the same job already has a
/// run in flight (single-flight guard — sweeps are idempotent but overlapping
/// them wastes upstream calls). Also prunes that job's history to
/// [`KEEP_PER_JOB`] rows.
pub async fn start(
    pool: &PgPool,
    job_name: &str,
    triggered_by: &str,
    actor: Option<Uuid>,
) -> AppResult<Option<Uuid>> {
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
        "INSERT INTO server_job_runs (job_name, triggered_by, triggered_by_user)
         VALUES ($1, $2, $3) RETURNING id",
    )
    .bind(job_name)
    .bind(triggered_by)
    .bind(actor)
    .fetch_one(pool)
    .await?;
    Ok(Some(id))
}

pub async fn finish_ok(
    pool: &PgPool,
    id: Uuid,
    result: &serde_json::Value,
    changed: Option<i64>,
) -> AppResult<()> {
    sqlx::query(
        "UPDATE server_job_runs
         SET state = 'ready', result = $2, changed = $3, finished_at = now()
         WHERE id = $1",
    )
    .bind(id)
    .bind(result)
    .bind(changed)
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

/// Columns selected for every `ServerJobRun` query — kept in one place so the
/// list and `get` can't drift apart (FromRow maps by name). Qualified with the
/// `sjr` alias so the `users` LEFT JOIN (for `triggered_by_username`) stays
/// unambiguous; see [`JOB_FROM`].
const SELECT_COLS: &str = "sjr.id, sjr.job_name, sjr.triggered_by, sjr.state, sjr.result,
                           sjr.error_message, sjr.changed, sjr.triggered_by_user,
                           u.username AS triggered_by_username,
                           sjr.started_at, sjr.finished_at";

/// FROM + the LEFT JOIN that resolves the manual actor's username. Aliased so
/// `SELECT_COLS` / `JOB_WHERE` can qualify their columns.
const JOB_FROM: &str = "FROM server_job_runs sjr
                        LEFT JOIN users u ON u.id = sjr.triggered_by_user";

/// Shared WHERE for `list_filtered` + its count. A NULL text param matches
/// anything; the no-op guard treats a NULL `changed` (legacy/unknown) as
/// "did something", so such runs are never hidden. Columns qualified with the
/// `sjr` alias for the joined queries.
const JOB_WHERE: &str = "WHERE ($1::text IS NULL OR sjr.job_name = $1)
       AND ($2::text IS NULL OR sjr.state = $2)
       AND ($3::text IS NULL OR sjr.triggered_by = $3)
       AND ($4 = false OR NOT (sjr.state = 'ready' AND COALESCE(sjr.changed, 1) = 0))";

/// Filters for the admin task console. Deserialized straight from the query
/// string; every field is optional.
#[derive(Debug, Default, serde::Deserialize)]
pub struct JobFilter {
    pub job_name: Option<String>,
    pub state: Option<String>,
    pub triggered_by: Option<String>,
    #[serde(default)]
    pub hide_noop: bool,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

/// A page of runs plus the total number matching the filter (for pagination).
#[derive(Debug, Serialize)]
pub struct JobRunsPage {
    pub items: Vec<ServerJobRun>,
    pub total: i64,
}

/// Filtered, paginated runs (most recent first) + the total match count.
pub async fn list_filtered(pool: &PgPool, f: &JobFilter) -> AppResult<JobRunsPage> {
    let limit = f.limit.unwrap_or(50).clamp(1, 200);
    let offset = f.offset.unwrap_or(0).max(0);

    let items = sqlx::query_as::<_, ServerJobRun>(&format!(
        "SELECT {SELECT_COLS} {JOB_FROM} {JOB_WHERE}
         ORDER BY sjr.started_at DESC LIMIT $5 OFFSET $6"
    ))
    .bind(&f.job_name)
    .bind(&f.state)
    .bind(&f.triggered_by)
    .bind(f.hide_noop)
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await?;

    let total: i64 = sqlx::query_scalar(&format!(
        "SELECT count(*) {JOB_FROM} {JOB_WHERE}"
    ))
    .bind(&f.job_name)
    .bind(&f.state)
    .bind(&f.triggered_by)
    .bind(f.hide_noop)
    .fetch_one(pool)
    .await?;

    Ok(JobRunsPage { items, total })
}

pub async fn get(pool: &PgPool, id: Uuid) -> AppResult<Option<ServerJobRun>> {
    Ok(sqlx::query_as::<_, ServerJobRun>(&format!(
        "SELECT {SELECT_COLS} {JOB_FROM} WHERE sjr.id = $1"
    ))
    .bind(id)
    .fetch_optional(pool)
    .await?)
}

/// Delete one run row outright. A run is an execution RECORD, so removing it
/// just drops history; if the row was still `processing`, the in-process /
/// worker task that finishes later simply UPDATEs 0 rows (harmless). Returns
/// the number of rows removed (0 if the id was already gone).
pub async fn delete(pool: &PgPool, id: Uuid) -> AppResult<u64> {
    let res = sqlx::query("DELETE FROM server_job_runs WHERE id = $1")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(res.rows_affected())
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

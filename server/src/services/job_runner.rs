//! Registry + recorder for the server's in-process background jobs.
//!
//! Each scheduler loop runs its sweep through [`run_recorded`], which books a
//! `server_job_runs` row around the call (see [`crate::domain::server_job`]) so
//! the admin Tasks page can show server tasks — state, trigger, result, error —
//! next to the worker scan queue. The admin "relaunch" route goes through
//! [`spawn_manual`], which records the same way with `triggered_by = manual`.

use crate::domain::server_job;
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use uuid::Uuid;

pub const JOB_PRICE_CRON: &str = "price_cron";
pub const JOB_RELEASE_CRON: &str = "release_cron";
pub const JOB_SCAN_CLEANUP: &str = "scan_cleanup";
pub const JOB_MANGA_SYNC: &str = "manga_sync";

pub const TRIGGER_SCHEDULE: &str = "schedule";
pub const TRIGGER_MANUAL: &str = "manual";

fn is_known(job_name: &str) -> bool {
    matches!(
        job_name,
        JOB_PRICE_CRON | JOB_RELEASE_CRON | JOB_SCAN_CLEANUP | JOB_MANGA_SYNC
    )
}

/// Dispatch a job name to its sweep. Every sweep returns a JSON summary that
/// lands in `server_job_runs.result` (the admin page renders it).
async fn execute(state: &AppState, job_name: &str) -> AppResult<serde_json::Value> {
    match job_name {
        JOB_PRICE_CRON => crate::services::price_cron::run_once(state).await,
        JOB_RELEASE_CRON => crate::services::release_cron::run_once(state).await,
        JOB_SCAN_CLEANUP => crate::services::scan_cleanup::run_once(state).await,
        JOB_MANGA_SYNC => crate::services::manga_sync::run_once(state).await,
        _ => Err(AppError::BadRequest("unknown job")),
    }
}

/// Run a job now, recording the run. Never propagates errors — scheduler
/// loops must survive any tick. A tick is skipped (and logged) when the same
/// job is already in flight.
pub async fn run_recorded(state: &AppState, job_name: &str, triggered_by: &str) {
    let run_id = match server_job::start(&state.pool, job_name, triggered_by).await {
        Ok(Some(id)) => id,
        Ok(None) => {
            tracing::info!(job = job_name, "job already running — tick skipped");
            return;
        }
        Err(e) => {
            tracing::warn!(job = job_name, error = ?e, "could not record job start");
            return;
        }
    };
    execute_and_finish(state, run_id, job_name).await;
}

/// Start a manual run (admin relaunch): book the row, execute in the
/// background, return the new run id immediately. `None` = already running.
pub async fn spawn_manual(state: &AppState, job_name: &str) -> AppResult<Option<Uuid>> {
    if !is_known(job_name) {
        return Err(AppError::BadRequest("unknown job"));
    }
    let Some(run_id) = server_job::start(&state.pool, job_name, TRIGGER_MANUAL).await? else {
        return Ok(None);
    };
    let st = state.clone();
    let name = job_name.to_string();
    tokio::spawn(async move {
        execute_and_finish(&st, run_id, &name).await;
    });
    Ok(Some(run_id))
}

async fn execute_and_finish(state: &AppState, run_id: Uuid, job_name: &str) {
    match execute(state, job_name).await {
        Ok(result) => {
            tracing::info!(job = job_name, run = %run_id, %result, "job succeeded");
            if let Err(e) = server_job::finish_ok(&state.pool, run_id, &result).await {
                tracing::warn!(job = job_name, error = ?e, "could not record job result");
            }
        }
        Err(e) => {
            tracing::warn!(job = job_name, run = %run_id, error = ?e, "job failed");
            if let Err(e2) = server_job::finish_failed(&state.pool, run_id, &e.to_string()).await {
                tracing::warn!(job = job_name, error = ?e2, "could not record job failure");
            }
        }
    }
}

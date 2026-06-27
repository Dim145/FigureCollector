//! Registry + recorder for the server's in-process background jobs.
//!
//! Each scheduler loop runs its sweep through [`run_recorded`], which books a
//! `server_job_runs` row around the call (see [`crate::domain::server_job`]) so
//! the admin Tasks page can show server tasks — state, trigger, result, error —
//! next to the worker scan queue. The admin "relaunch" route goes through
//! [`spawn_manual`], which records the same way with `triggered_by = manual`.

use crate::domain::{server_job, service_health};
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
    let run_id = match server_job::start(&state.pool, job_name, triggered_by, None).await {
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
/// `actor` is the admin who triggered it, recorded on the run.
pub async fn spawn_manual(
    state: &AppState,
    job_name: &str,
    actor: Option<Uuid>,
) -> AppResult<Option<Uuid>> {
    if !is_known(job_name) {
        return Err(AppError::BadRequest("unknown job"));
    }
    let Some(run_id) = server_job::start(&state.pool, job_name, TRIGGER_MANUAL, actor).await?
    else {
        return Ok(None);
    };
    let st = state.clone();
    let name = job_name.to_string();
    tokio::spawn(async move {
        execute_and_finish(&st, run_id, &name).await;
    });
    Ok(Some(run_id))
}

/// The generic "items changed" count for a finished run, used to flag no-op
/// runs (`changed == 0`) so the admin console can hide them. Prefers an explicit
/// `changed` key in the result JSON (the convention for newer jobs, incl. the
/// instrumented plumbing); otherwise sums the known work-counters of each
/// built-in job. `None` for an unknown job (such runs are never treated no-op).
fn changed_from(job_name: &str, result: &serde_json::Value) -> Option<i64> {
    if let Some(c) = result.get("changed").and_then(|v| v.as_i64()) {
        return Some(c);
    }
    let sum = |keys: &[&str]| -> i64 {
        keys.iter()
            .filter_map(|k| result.get(*k).and_then(|v| v.as_i64()))
            .sum()
    };
    let n = match job_name {
        JOB_RELEASE_CRON => sum(&[
            "release_today",
            "release_j7",
            "delivery_today",
            "delivery_overdue",
        ]),
        JOB_SCAN_CLEANUP => sum(&["purged"]),
        JOB_MANGA_SYNC => sum(&["filled"]),
        JOB_PRICE_CRON => sum(&["updated", "stock_updated"]),
        name if name.starts_with("reindex") => sum(&["indexed", "queued"]),
        _ => return None,
    };
    Some(n)
}

async fn execute_and_finish(state: &AppState, run_id: Uuid, job_name: &str) {
    match execute(state, job_name).await {
        Ok(result) => {
            tracing::info!(job = job_name, run = %run_id, %result, "job succeeded");
            let changed = changed_from(job_name, &result);
            if let Err(e) = server_job::finish_ok(&state.pool, run_id, &result, changed).await {
                tracing::warn!(job = job_name, error = ?e, "could not record job result");
            }
            let _ = service_health::beat(&state.pool, job_name, "cron", "ok", Some(result)).await;
        }
        Err(e) => {
            tracing::warn!(job = job_name, run = %run_id, error = ?e, "job failed");
            let msg = e.to_string();
            if let Err(e2) = server_job::finish_failed(&state.pool, run_id, &msg).await {
                tracing::warn!(job = job_name, error = ?e2, "could not record job failure");
            }
            let _ = service_health::record_error(&state.pool, job_name, &msg).await;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn explicit_changed_key_wins() {
        // A result carrying its own `changed` is taken verbatim …
        assert_eq!(changed_from("anything", &json!({ "changed": 7 })), Some(7));
        // … even when per-job counters would sum to something else.
        assert_eq!(
            changed_from("release_cron", &json!({ "changed": 1, "release_today": 9 })),
            Some(1)
        );
    }

    #[test]
    fn sums_the_known_counters_per_job() {
        assert_eq!(
            changed_from(
                "release_cron",
                &json!({ "release_today": 1, "release_j7": 2, "delivery_today": 0, "delivery_overdue": 3 })
            ),
            Some(6)
        );
        assert_eq!(changed_from("scan_cleanup", &json!({ "purged": 4 })), Some(4));
        assert_eq!(changed_from("manga_sync", &json!({ "filled": 2 })), Some(2));
        assert_eq!(changed_from("price_cron", &json!({ "updated": 9 })), Some(9));
        assert_eq!(
            changed_from("reindex_image", &json!({ "indexed": 3, "queued": 1 })),
            Some(4)
        );
    }

    #[test]
    fn zero_for_a_noop_known_job_but_none_for_unknown() {
        // A successful run that touched nothing → Some(0) → the console may hide it.
        assert_eq!(changed_from("scan_cleanup", &json!({ "purged": 0 })), Some(0));
        assert_eq!(changed_from("scan_cleanup", &json!({})), Some(0));
        // An unknown job → None → never treated as a no-op.
        assert_eq!(changed_from("mystery_job", &json!({ "foo": 1 })), None);
    }
}

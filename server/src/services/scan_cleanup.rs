//! Periodic cleanup of completed gsplat tasks (Lot 9).
//!
//! Keeps the `GSPLAT_KEEP_COMPLETED` (default 5) most-recent SUCCESSFUL gsplat
//! scans **per figurine** and purges older ones — both the DB row (done in SQL)
//! and the Garage blobs. Failures, in-flight jobs, and turntables are never
//! touched, so a figurine never loses its only 3D model — only stale re-scans.

use crate::services::job_runner;
use crate::state::AppState;
use std::time::Duration;

const DEFAULT_KEEP: i64 = 5;
const INTERVAL_SECS: u64 = 60 * 60; // hourly
/// Matches the per-scan frame cap on the producer side (routes::scans).
const MAX_FRAMES: usize = 96;

/// How many successful scans to keep per figurine — `GSPLAT_KEEP_COMPLETED`,
/// floored at 1, default 5.
fn keep_count() -> i64 {
    std::env::var("GSPLAT_KEEP_COMPLETED")
        .ok()
        .and_then(|v| v.parse::<i64>().ok())
        .filter(|n| *n >= 1)
        .unwrap_or(DEFAULT_KEEP)
}

/// Spawn the hourly cleanup loop. Returns immediately.
pub fn spawn(state: AppState) {
    tokio::spawn(async move {
        // Settle after boot (migrations, listeners) before the first sweep.
        tokio::time::sleep(Duration::from_secs(120)).await;
        loop {
            // Recorded in server_job_runs (admin Tasks page).
            job_runner::run_recorded(
                &state,
                job_runner::JOB_SCAN_CLEANUP,
                job_runner::TRIGGER_SCHEDULE,
            )
            .await;
            tokio::time::sleep(Duration::from_secs(INTERVAL_SECS)).await;
        }
    });
}

/// One sweep. Returns the purge summary recorded into `server_job_runs.result`.
/// Public so the job runner / admin relaunch route can trigger it.
pub async fn run_once(state: &AppState) -> crate::error::AppResult<serde_json::Value> {
    let keep = keep_count();
    let purged = crate::domain::scan::cleanup_completed(&state.pool, keep).await?;
    if !purged.is_empty() {
        tracing::info!(
            count = purged.len(),
            keep,
            "scan-cleanup: purged stale completed gsplat scans"
        );
        for (prefix, result_key) in &purged {
            purge_scan_blobs(state, prefix, result_key.as_deref()).await;
        }
    }
    Ok(serde_json::json!({ "purged": purged.len(), "keep": keep }))
}

/// Best-effort delete of a scan's Garage blobs: every frame, the result `.ply`,
/// and the source video. Garage shrugs at missing keys, so over-probing is fine.
/// Shared by the admin "delete task" route and the cleanup sweep.
pub async fn purge_scan_blobs(state: &AppState, storage_prefix: &str, result_key: Option<&str>) {
    for idx in 0..MAX_FRAMES {
        let _ = state
            .storage
            .delete(&format!("{storage_prefix}frame_{idx:03}.webp"))
            .await;
    }
    if let Some(rk) = result_key {
        let _ = state.storage.delete(rk).await;
    }
    for ext in ["mp4", "mov", "webm", "mkv", "avi"] {
        let _ = state
            .storage
            .delete(&format!("{storage_prefix}source.{ext}"))
            .await;
    }
}

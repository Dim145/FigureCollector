//! Daily backfill of `series.manga_mal_id` — the cross-media join key the
//! MangaCollector crossings rely on (see `domain::manga`).
//!
//! A figurine's series is usually linked to the ANIME, but the manga shelf is
//! keyed on the MANGA's MAL id (a different number). For each series that
//! carries an AniList id but no resolved manga id yet, this asks AniList for the
//! related manga's MAL id (cached 24h) and stores it — so the catalogue lines up
//! with manga libraries without anyone re-tagging anything. Capped per run; the
//! cache warms the catalogue over a few days and a `0` sentinel marks "no manga
//! side" so the same rows aren't reprocessed forever. Users who don't want to
//! wait can hit the manual sync button (per-user, scoped to their own series).

use crate::services::job_runner;
use crate::state::AppState;
use std::time::Duration;

/// Series resolved per daily tick. AniList lookups are cached, so this is mostly
/// a courtesy cap on cold catalogues; a backlog drains over a few days.
const BACKFILL_LIMIT_PER_RUN: i64 = 300;

/// Spawn the long-running scheduler. Returns immediately; the work happens on a
/// background tokio task (first tick after a short delay, then every 24h).
pub fn spawn(state: AppState) {
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_secs(90)).await;
        loop {
            // Recorded in server_job_runs (admin Tasks page).
            job_runner::run_recorded(
                &state,
                job_runner::JOB_MANGA_SYNC,
                job_runner::TRIGGER_SCHEDULE,
            )
            .await;
            tokio::time::sleep(Duration::from_secs(24 * 60 * 60)).await;
        }
    });
}

/// One backfill pass. Returns the fill count recorded into
/// `server_job_runs.result`. Public so the job runner / admin relaunch route
/// can trigger it.
pub async fn run_once(state: &AppState) -> crate::error::AppResult<serde_json::Value> {
    let filled = crate::domain::manga::backfill_manga_mal(
        &state.pool,
        &state.http,
        BACKFILL_LIMIT_PER_RUN,
        None,
    )
    .await?;
    if filled > 0 {
        tracing::info!(filled, "manga-sync: backfilled series manga_mal_id");
    }
    Ok(serde_json::json!({ "filled": filled }))
}

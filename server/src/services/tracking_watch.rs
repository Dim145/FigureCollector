//! Delivered-parcel watcher.
//!
//! Every `TRACKING_WATCH_INTERVAL_MINUTES` (default 60, `0` disables), checks
//! the live status of each shipped preorder carrying a tracking link or
//! number, and fires `preorder_parcel_delivered` once when the carrier
//! reports it delivered. It does NOT change the preorder's status — marking
//! it received (and filing the arrival report) stays the user's call.
//!
//! Goes through the tracking proxy (`external::tracking::fetch`), so it
//! shares its cache: an in-transit status is refetched at most every 15 min,
//! a delivered one is served from cache for 24 h. With Parcels this costs no
//! extra quota — a number is billed once per cycle however often it's read.
//!
//! Stays idle (no run recorded, no upstream call) while the server has no
//! tracking source configured.

use crate::domain::notification;
use crate::error::{AppError, AppResult};
use crate::external::tracking::{self, parse};
use crate::services::{job_runner, notify};
use crate::state::AppState;
use serde_json::json;
use sqlx::FromRow;
use std::time::Duration;
use uuid::Uuid;

/// Boot-settle delay (migrations + the other loops) before the first sweep.
const BOOT_DELAY_SECS: u64 = 150;
/// Politeness gap between two upstream lookups.
const INTER_REQUEST_MS: u64 = 1_000;
/// Hard cap on shipments checked per sweep.
const MAX_PER_RUN: i64 = 200;
/// Stop watching this long after shipping: a parcel still undelivered after
/// four months is lost, or the preorder was never updated.
const MAX_AGE_DAYS: i32 = 120;

#[derive(Debug, FromRow)]
struct WatchedRow {
    preorder_id: Uuid,
    user_id: Uuid,
    figure_id: Uuid,
    figure_name: String,
    tracking_url: String,
}

fn dedup_key(preorder_id: Uuid) -> String {
    format!("parcel-delivered:{preorder_id}")
}

/// Spawn the watcher loop. Returns immediately.
pub fn spawn(state: AppState) {
    let minutes = state.config.tracking.watch_interval_minutes;
    if minutes == 0 {
        tracing::info!("tracking-watch disabled (TRACKING_WATCH_INTERVAL_MINUTES=0)");
        return;
    }
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_secs(BOOT_DELAY_SECS)).await;
        loop {
            if tracking::any_provider(&state.config.tracking) {
                job_runner::run_recorded(
                    &state,
                    job_runner::JOB_TRACKING_WATCH,
                    job_runner::TRIGGER_SCHEDULE,
                )
                .await;
            }
            tokio::time::sleep(Duration::from_secs(minutes * 60)).await;
        }
    });
}

/// One sweep. Returns the counts recorded into `server_job_runs.result`.
pub async fn run_once(state: &AppState) -> AppResult<serde_json::Value> {
    let config = &state.config.tracking;
    if !tracking::any_provider(config) {
        return Ok(json!({ "checked": 0, "delivered": 0 }));
    }

    let rows = fetch_watched(&state.pool).await?;
    let (mut checked, mut delivered, mut pending, mut failed) = (0u32, 0u32, 0u32, 0u32);

    for row in rows {
        let Some(parsed) = parse::parse(&row.tracking_url) else {
            continue; // unknown host / no number: a plain link, nothing to poll
        };
        if tracking::provider_for(config, parsed.carrier).is_none() {
            continue;
        }
        if checked > 0 {
            tokio::time::sleep(Duration::from_millis(INTER_REQUEST_MS)).await;
        }
        checked += 1;

        match tracking::fetch(&state.pool, &state.http, config, parsed.carrier, &parsed.number)
            .await
        {
            Ok(status) if status.pending => pending += 1,
            Ok(status) if status.is_delivered => {
                // The carrier the user picked wins (same rule as the SPA
                // chip); the detected name only fills in for a bare number.
                let carrier = Some(carrier_label(parsed.carrier))
                    .filter(|l| !l.is_empty())
                    .map(str::to_string)
                    .or_else(|| status.carrier_name.clone())
                    .unwrap_or_default();
                let fired = notify::dispatch(
                    state,
                    row.user_id,
                    notification::EVENT_PREORDER_PARCEL_DELIVERED,
                    json!({
                        "preorder_id":  row.preorder_id,
                        "figure_id":    row.figure_id,
                        "figure_name":  row.figure_name,
                        "carrier":      carrier,
                        "location":     status.location,
                        "delivered_at": status.timestamp,
                    }),
                    Some(&dedup_key(row.preorder_id)),
                )
                .await;
                if fired {
                    delivered += 1;
                }
            }
            Ok(_) => {}
            // The carrier doesn't know the number yet (fresh label).
            Err(AppError::NotFound) => {}
            // Account-level trouble (bad key, quota spent, upstream busy):
            // every further call would fail the same way — stop for now.
            Err(e @ AppError::ServiceUnavailable(_)) => {
                failed += 1;
                tracing::warn!(error = %e, "tracking-watch: upstream unavailable, sweep stopped");
                break;
            }
            Err(e) => {
                failed += 1;
                tracing::warn!(
                    preorder = %row.preorder_id,
                    carrier = parsed.carrier,
                    error = %e,
                    "tracking-watch: lookup failed"
                );
            }
        }
    }

    Ok(json!({
        "checked": checked,
        "delivered": delivered,
        "pending": pending,
        "failed": failed,
    }))
}

/// Shipped preorders with something to track, not yet announced delivered.
async fn fetch_watched(pool: &sqlx::PgPool) -> anyhow::Result<Vec<WatchedRow>> {
    Ok(sqlx::query_as::<_, WatchedRow>(
        "SELECT p.id           AS preorder_id,
                p.user_id      AS user_id,
                p.figure_id    AS figure_id,
                f.name         AS figure_name,
                p.tracking_url AS tracking_url
           FROM preorders p
           JOIN figures f ON f.id = p.figure_id
          WHERE p.status = 'shipped'
            AND p.tracking_url IS NOT NULL
            AND btrim(p.tracking_url) <> ''
            AND (p.shipped_at IS NULL OR p.shipped_at > now() - make_interval(days => $1))
            AND NOT EXISTS (
                SELECT 1 FROM notification_dedup d
                 WHERE d.user_id = p.user_id
                   AND d.event_type = $2
                   AND d.dedup_key = 'parcel-delivered:' || p.id::text
            )
          ORDER BY p.shipped_at DESC NULLS LAST
          LIMIT $3",
    )
    .bind(MAX_AGE_DAYS)
    .bind(notification::EVENT_PREORDER_PARCEL_DELIVERED)
    .bind(MAX_PER_RUN)
    .fetch_all(pool)
    .await?)
}

/// Human name for a carrier id when the upstream didn't name it.
fn carrier_label(id: &str) -> &'static str {
    match id {
        "ups" => "UPS",
        "dhl" => "DHL",
        "colissimo" => "Colissimo",
        "chronopost" => "Chronopost",
        "fedex" => "FedEx",
        "usps" => "USPS",
        "mondialrelay" => "Mondial Relay",
        "gls" => "GLS",
        "tnt" => "TNT",
        "japanpost" => "Japan Post",
        "ems" => "EMS",
        "yamato" => "Yamato",
        "sagawa" => "Sagawa",
        "hermes" => "Evri",
        "dpd" => "DPD",
        "amazon" => "Amazon Logistics",
        _ => "",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dedup_key_matches_the_sql_exclusion() {
        // fetch_watched skips rows whose dedup row is 'parcel-delivered:' || id.
        let id = Uuid::nil();
        assert_eq!(
            dedup_key(id),
            "parcel-delivered:00000000-0000-0000-0000-000000000000"
        );
    }

    #[test]
    fn every_carrier_but_auto_has_a_label() {
        for id in parse::carrier_ids().filter(|c| *c != parse::AUTO) {
            assert!(!carrier_label(id).is_empty(), "missing label for {id}");
        }
    }
}

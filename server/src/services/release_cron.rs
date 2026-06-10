//! Daily tick that scans `preorders` and fires release-date notifications.
//!
//! Runs once on boot (after a short delay) and then daily, anchored at
//! 08:00 UTC (a flat +24h sleep drifts and can skip a calendar date).
//! For each user with a preorder whose `release_date_current` is exactly
//! today or today + 7 days (and whose status isn't `received` or
//! `cancelled`), it emits the corresponding event through the
//! notification dispatcher. The dispatcher's dedup table guarantees we
//! don't double-fire if the worker restarts during the day.

use crate::domain::notification;
use crate::services::{job_runner, notify};
use crate::state::AppState;
use chrono::NaiveDate;
use serde_json::json;
use sqlx::FromRow;
use std::time::Duration;
use uuid::Uuid;

#[derive(Debug, FromRow)]
struct DueRow {
    user_id: Uuid,
    figure_id: Uuid,
    figure_name: String,
    preorder_id: Uuid,
    release_date: NaiveDate,
}

/// The UTC hour-of-day the daily sweep fires at (08:00 UTC).
const RUN_HOUR_UTC: u32 = 8;

/// Spawn the long-running scheduler. Returns immediately; the work
/// happens on a background tokio task.
pub fn spawn(state: AppState) {
    tokio::spawn(async move {
        // First tick after a 60s delay so DB migrations + everything else
        // settle, AND so a fresh deploy covers "today" right away instead of
        // waiting until the next 08:00.
        tokio::time::sleep(Duration::from_secs(60)).await;
        loop {
            // Recorded in server_job_runs (admin Tasks page).
            job_runner::run_recorded(
                &state,
                job_runner::JOB_RELEASE_CRON,
                job_runner::TRIGGER_SCHEDULE,
            )
            .await;
            // Sleep to the NEXT 08:00 UTC rather than a flat +24h. A flat
            // interval drifts a little each tick (sleep granularity + run
            // duration); once the tick time crosses midnight UTC, a whole
            // calendar date is skipped and its release-today / J-7 rows —
            // matched by exact date equality — are never sent. Anchoring to a
            // fixed wall-clock hour eliminates the drift entirely.
            tokio::time::sleep(duration_until_next_run()).await;
        }
    });
}

/// Time from now until the next occurrence of `RUN_HOUR_UTC:00` UTC.
fn duration_until_next_run() -> Duration {
    use chrono::Utc;
    let now = Utc::now();
    let today_run = now
        .date_naive()
        .and_hms_opt(RUN_HOUR_UTC, 0, 0)
        .expect("valid hour")
        .and_utc();
    let next = if now < today_run {
        today_run
    } else {
        today_run + chrono::Duration::days(1)
    };
    Duration::from_secs((next - now).num_seconds().max(0) as u64)
}

/// One pass of the scheduler. Returns the notification counts recorded into
/// `server_job_runs.result`. Public so the job runner / tests can invoke it.
pub async fn run_once(state: &AppState) -> crate::error::AppResult<serde_json::Value> {
    let today = chrono::Utc::now().date_naive();
    let yesterday = today - chrono::Duration::days(1);
    let in_seven_days = today + chrono::Duration::days(7);

    let today_due = fetch_due(&state.pool, today).await?;
    let j7_due = fetch_due(&state.pool, in_seven_days).await?;
    // Delivery checks: shipped preorders with an ETA matching today
    // (delivery_today) or yesterday (delivery_overdue, fires J+1 only).
    let delivery_today = fetch_delivery_due(&state.pool, today).await?;
    let delivery_overdue = fetch_delivery_due(&state.pool, yesterday).await?;

    let counts = (
        today_due.len(),
        j7_due.len(),
        delivery_today.len(),
        delivery_overdue.len(),
    );
    tracing::info!(
        today_count = counts.0,
        j7_count = counts.1,
        delivery_today_count = counts.2,
        delivery_overdue_count = counts.3,
        "release-cron tick"
    );

    for row in today_due {
        let dedup = format!("{}:{}", row.preorder_id, row.release_date);
        notify::dispatch(
            state,
            row.user_id,
            notification::EVENT_PREORDER_RELEASE_TODAY,
            json!({
                "preorder_id": row.preorder_id,
                "figure_id":   row.figure_id,
                "figure_name": row.figure_name,
                "release_date": row.release_date.to_string(),
            }),
            Some(&dedup),
        )
        .await;
    }
    for row in j7_due {
        let dedup = format!("{}:{}", row.preorder_id, row.release_date);
        notify::dispatch(
            state,
            row.user_id,
            notification::EVENT_PREORDER_RELEASE_J7,
            json!({
                "preorder_id": row.preorder_id,
                "figure_id":   row.figure_id,
                "figure_name": row.figure_name,
                "release_date": row.release_date.to_string(),
            }),
            Some(&dedup),
        )
        .await;
    }
    for row in delivery_today {
        let dedup = format!("delivery-today:{}:{}", row.preorder_id, row.delivery_date);
        notify::dispatch(
            state,
            row.user_id,
            notification::EVENT_PREORDER_DELIVERY_TODAY,
            json!({
                "preorder_id": row.preorder_id,
                "figure_id":   row.figure_id,
                "figure_name": row.figure_name,
                "delivery_date": row.delivery_date.to_string(),
            }),
            Some(&dedup),
        )
        .await;
    }
    for row in delivery_overdue {
        // J+1 fires once — dedup on the preorder_id alone so we never
        // re-notify even if the worker restarts repeatedly.
        let dedup = format!("delivery-overdue:{}", row.preorder_id);
        notify::dispatch(
            state,
            row.user_id,
            notification::EVENT_PREORDER_DELIVERY_OVERDUE,
            json!({
                "preorder_id": row.preorder_id,
                "figure_id":   row.figure_id,
                "figure_name": row.figure_name,
                "delivery_date": row.delivery_date.to_string(),
            }),
            Some(&dedup),
        )
        .await;
    }
    Ok(json!({
        "release_today": counts.0,
        "release_j7": counts.1,
        "delivery_today": counts.2,
        "delivery_overdue": counts.3,
    }))
}

async fn fetch_due(pool: &sqlx::PgPool, date: NaiveDate) -> anyhow::Result<Vec<DueRow>> {
    Ok(sqlx::query_as::<_, DueRow>(
        "SELECT
            p.user_id           AS user_id,
            p.figure_id         AS figure_id,
            f.name              AS figure_name,
            p.id                AS preorder_id,
            p.release_date_current AS release_date
         FROM preorders p
         JOIN figures f ON f.id = p.figure_id
         WHERE p.release_date_current = $1
           AND p.status NOT IN ('received', 'cancelled')",
    )
    .bind(date)
    .fetch_all(pool)
    .await?)
}

#[derive(Debug, FromRow)]
struct DeliveryDueRow {
    user_id: Uuid,
    figure_id: Uuid,
    figure_name: String,
    preorder_id: Uuid,
    delivery_date: NaiveDate,
}

/// Find shipped preorders whose projected delivery date (shipped_at::date
/// + estimated_delivery_days) equals the given target date.
///
/// Excludes preorders that have already been marked `received` (the user
/// got the figurine) or `cancelled` (no shipment will happen).
async fn fetch_delivery_due(
    pool: &sqlx::PgPool,
    target: NaiveDate,
) -> anyhow::Result<Vec<DeliveryDueRow>> {
    // `shipped_at` is a timestamptz; cast its date in UTC explicitly so the
    // projected delivery date agrees with `today = Utc::now().date_naive()`
    // regardless of the Postgres session TimeZone (a non-UTC server TimeZone
    // would otherwise shift the date by one around midnight).
    Ok(sqlx::query_as::<_, DeliveryDueRow>(
        "SELECT
            p.user_id   AS user_id,
            p.figure_id AS figure_id,
            f.name      AS figure_name,
            p.id        AS preorder_id,
            ((p.shipped_at AT TIME ZONE 'UTC')::date + p.estimated_delivery_days * INTERVAL '1 day')::date
                        AS delivery_date
         FROM preorders p
         JOIN figures f ON f.id = p.figure_id
         WHERE p.shipped_at IS NOT NULL
           AND p.estimated_delivery_days IS NOT NULL
           AND p.status NOT IN ('received', 'cancelled')
           AND ((p.shipped_at AT TIME ZONE 'UTC')::date + p.estimated_delivery_days * INTERVAL '1 day')::date = $1",
    )
    .bind(target)
    .fetch_all(pool)
    .await?)
}

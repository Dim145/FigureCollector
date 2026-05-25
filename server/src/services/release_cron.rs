//! Daily tick that scans `preorders` and fires release-date notifications.
//!
//! Runs once on boot (after a short delay) and then every 24 hours.
//! For each user with a preorder whose `release_date_current` is exactly
//! today or today + 7 days (and whose status isn't `received` or
//! `cancelled`), it emits the corresponding event through the
//! notification dispatcher. The dispatcher's dedup table guarantees we
//! don't double-fire if the worker restarts during the day.

use crate::domain::notification;
use crate::services::notify;
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

/// Spawn the long-running scheduler. Returns immediately; the work
/// happens on a background tokio task.
pub fn spawn(state: AppState) {
    tokio::spawn(async move {
        // First tick after a 60s delay so DB migrations + everything
        // else settles before we start sending things.
        tokio::time::sleep(Duration::from_secs(60)).await;
        loop {
            if let Err(e) = run_once(&state).await {
                tracing::warn!(error = ?e, "release-cron tick failed");
            }
            tokio::time::sleep(Duration::from_secs(24 * 60 * 60)).await;
        }
    });
}

/// One pass of the scheduler. Public so tests / admin tooling can invoke it
/// manually.
pub async fn run_once(state: &AppState) -> anyhow::Result<()> {
    let today = chrono::Utc::now().date_naive();
    let in_seven_days = today + chrono::Duration::days(7);

    let today_due = fetch_due(&state.pool, today).await?;
    let j7_due = fetch_due(&state.pool, in_seven_days).await?;

    tracing::info!(
        today_count = today_due.len(),
        j7_count = j7_due.len(),
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
    Ok(())
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

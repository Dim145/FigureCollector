//! Activity feed — append-only log of meaningful per-user events.
//!
//! Each row carries a *denormalised snapshot* in `payload` so the feed
//! renders the figure name / manufacturer / status as they were at the
//! time, regardless of subsequent edits or deletes.

use crate::error::AppResult;
use chrono::{DateTime, NaiveDate, Utc};
use rust_decimal::Decimal;
use serde::Serialize;
use sqlx::{FromRow, PgPool};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct ActivityEvent {
    pub id: Uuid,
    pub kind: String,
    pub payload: serde_json::Value,
    pub created_at: DateTime<Utc>,
}

/// Append a new event. Errors are logged but do not propagate — the activity
/// feed must never block the actual mutation it observes.
pub async fn record(pool: &PgPool, user_id: Uuid, kind: &str, payload: serde_json::Value) {
    let result = sqlx::query(
        "INSERT INTO activity_events (id, user_id, kind, payload) VALUES ($1, $2, $3, $4)",
    )
    .bind(Uuid::now_v7())
    .bind(user_id)
    .bind(kind)
    .bind(payload)
    .execute(pool)
    .await;

    if let Err(e) = result {
        tracing::warn!(error = ?e, user_id = %user_id, kind, "failed to record activity event");
    }
}

/// Fetch a figure summary suitable for embedding in an activity payload.
pub async fn figure_snapshot(pool: &PgPool, figure_id: Uuid) -> serde_json::Value {
    let row: Option<(String, String, Option<String>, Option<String>)> = sqlx::query_as(
        "SELECT f.name, f.figure_type, m.name, f.official_image_url
         FROM figures f
         LEFT JOIN manufacturers m ON m.id = f.manufacturer_id
         WHERE f.id = $1",
    )
    .bind(figure_id)
    .fetch_optional(pool)
    .await
    .ok()
    .flatten();

    if let Some((name, ftype, manufacturer, image)) = row {
        serde_json::json!({
            "figure_id": figure_id,
            "figure_name": name,
            "figure_type": ftype,
            "manufacturer_name": manufacturer,
            "figure_image": image,
        })
    } else {
        serde_json::json!({ "figure_id": figure_id })
    }
}

#[derive(Debug, Clone, Copy)]
pub struct ListParams {
    pub limit: i64,
    pub offset: i64,
}

impl Default for ListParams {
    fn default() -> Self {
        Self { limit: 50, offset: 0 }
    }
}

pub async fn list_for_user(
    pool: &PgPool,
    user_id: Uuid,
    params: ListParams,
) -> AppResult<Vec<ActivityEvent>> {
    let limit = params.limit.clamp(1, 200);
    let offset = params.offset.max(0);

    let rows = sqlx::query_as::<_, ActivityEvent>(
        "SELECT id, kind, payload, created_at
         FROM activity_events
         WHERE user_id = $1
         ORDER BY created_at DESC
         LIMIT $2 OFFSET $3",
    )
    .bind(user_id)
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await?;

    Ok(rows)
}

// -----------------------------------------------------------------------------
// Year-in-Review aggregates
// -----------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
pub struct YearInReview {
    pub year: i32,
    pub pieces_acquired: i64,
    pub spend_by_currency: Vec<SpendRow>,
    pub top_manufacturer: Option<TopRow>,
    pub top_series: Option<TopRow>,
    pub longest_slip: Option<LongestSlip>,
    pub monthly_pieces: Vec<MonthCount>,
    pub first_acquisition: Option<MilestoneRef>,
    pub last_acquisition: Option<MilestoneRef>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SpendRow {
    pub currency: String,
    pub total: Decimal,
}

#[derive(Debug, Clone, Serialize)]
pub struct TopRow {
    pub name: String,
    pub count: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct LongestSlip {
    pub preorder_id: Uuid,
    pub figure_name: String,
    pub slip_count: i64,
    pub original_date: Option<NaiveDate>,
    pub current_date: Option<NaiveDate>,
}

#[derive(Debug, Clone, Serialize)]
pub struct MonthCount {
    pub month: i32, // 1..=12
    pub count: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct MilestoneRef {
    pub at: DateTime<Utc>,
    pub figure_name: String,
}

pub async fn year_in_review(pool: &PgPool, user_id: Uuid, year: i32) -> AppResult<YearInReview> {
    let start = NaiveDate::from_ymd_opt(year, 1, 1).unwrap();
    let end = NaiveDate::from_ymd_opt(year + 1, 1, 1).unwrap();

    // Pieces acquired (counted from activity_events: owned_added)
    let pieces: (Option<i64>,) = sqlx::query_as(
        "SELECT COUNT(*)::bigint FROM activity_events
         WHERE user_id = $1 AND kind = 'owned_added'
           AND created_at >= $2 AND created_at < $3",
    )
    .bind(user_id)
    .bind(start)
    .bind(end)
    .fetch_one(pool)
    .await?;
    let pieces_acquired = pieces.0.unwrap_or(0);

    // Spend by currency (sum from owned_items where purchase_date in year)
    let spend_rows: Vec<(String, Decimal)> = sqlx::query_as(
        "SELECT price_currency, COALESCE(SUM(price_amount), 0)::numeric
         FROM owned_items
         WHERE user_id = $1
           AND price_amount IS NOT NULL
           AND price_currency IS NOT NULL
           AND COALESCE(purchase_date, created_at::date) >= $2
           AND COALESCE(purchase_date, created_at::date) <  $3
         GROUP BY price_currency
         ORDER BY 2 DESC",
    )
    .bind(user_id)
    .bind(start)
    .bind(end)
    .fetch_all(pool)
    .await?;
    let spend_by_currency = spend_rows
        .into_iter()
        .map(|(currency, total)| SpendRow { currency, total })
        .collect();

    // Top manufacturer
    let top_mfr: Option<(String, i64)> = sqlx::query_as(
        "SELECT payload->>'manufacturer_name' AS name, COUNT(*)::bigint
         FROM activity_events
         WHERE user_id = $1 AND kind = 'owned_added'
           AND created_at >= $2 AND created_at < $3
           AND payload->>'manufacturer_name' IS NOT NULL
         GROUP BY name
         ORDER BY 2 DESC
         LIMIT 1",
    )
    .bind(user_id)
    .bind(start)
    .bind(end)
    .fetch_optional(pool)
    .await?;
    let top_manufacturer = top_mfr.map(|(name, count)| TopRow { name, count });

    // Top series (joining via figure_series for acquisitions of the year)
    let top_series: Option<(String, i64)> = sqlx::query_as(
        "SELECT s.name, COUNT(*)::bigint
         FROM owned_items o
         JOIN figure_series fs ON fs.figure_id = o.figure_id
         JOIN series s          ON s.id        = fs.series_id
         WHERE o.user_id = $1
           AND COALESCE(o.purchase_date, o.created_at::date) >= $2
           AND COALESCE(o.purchase_date, o.created_at::date) <  $3
         GROUP BY s.name
         ORDER BY 2 DESC
         LIMIT 1",
    )
    .bind(user_id)
    .bind(start)
    .bind(end)
    .fetch_optional(pool)
    .await?;
    let top_series = top_series.map(|(name, count)| TopRow { name, count });

    // Longest slip — preorder with the most date_history entries in the year
    let longest_slip: Option<(Uuid, String, i64, Option<NaiveDate>, Option<NaiveDate>)> =
        sqlx::query_as(
            "SELECT p.id, f.name, COUNT(h.id)::bigint, p.release_date_original, p.release_date_current
             FROM preorders p
             JOIN figures f ON f.id = p.figure_id
             LEFT JOIN preorder_date_history h
                    ON h.preorder_id = p.id
                   AND h.noted_at >= $2 AND h.noted_at < $3
             WHERE p.user_id = $1
             GROUP BY p.id, f.name
             HAVING COUNT(h.id) > 0
             ORDER BY 3 DESC
             LIMIT 1",
        )
        .bind(user_id)
        .bind(start)
        .bind(end)
        .fetch_optional(pool)
        .await?;
    let longest_slip = longest_slip.map(
        |(preorder_id, figure_name, slip_count, original_date, current_date)| LongestSlip {
            preorder_id,
            figure_name,
            slip_count,
            original_date,
            current_date,
        },
    );

    // Monthly timeline
    let monthly: Vec<(i32, i64)> = sqlx::query_as(
        "SELECT EXTRACT(MONTH FROM created_at)::int, COUNT(*)::bigint
         FROM activity_events
         WHERE user_id = $1 AND kind = 'owned_added'
           AND created_at >= $2 AND created_at < $3
         GROUP BY 1
         ORDER BY 1",
    )
    .bind(user_id)
    .bind(start)
    .bind(end)
    .fetch_all(pool)
    .await?;
    let monthly_pieces = monthly
        .into_iter()
        .map(|(month, count)| MonthCount { month, count })
        .collect();

    // First / last acquisition this year
    let first: Option<(DateTime<Utc>, String)> = sqlx::query_as(
        "SELECT created_at, COALESCE(payload->>'figure_name', '—')
         FROM activity_events
         WHERE user_id = $1 AND kind = 'owned_added'
           AND created_at >= $2 AND created_at < $3
         ORDER BY created_at ASC
         LIMIT 1",
    )
    .bind(user_id)
    .bind(start)
    .bind(end)
    .fetch_optional(pool)
    .await?;
    let last: Option<(DateTime<Utc>, String)> = sqlx::query_as(
        "SELECT created_at, COALESCE(payload->>'figure_name', '—')
         FROM activity_events
         WHERE user_id = $1 AND kind = 'owned_added'
           AND created_at >= $2 AND created_at < $3
         ORDER BY created_at DESC
         LIMIT 1",
    )
    .bind(user_id)
    .bind(start)
    .bind(end)
    .fetch_optional(pool)
    .await?;

    Ok(YearInReview {
        year,
        pieces_acquired,
        spend_by_currency,
        top_manufacturer,
        top_series,
        longest_slip,
        monthly_pieces,
        first_acquisition: first.map(|(at, figure_name)| MilestoneRef { at, figure_name }),
        last_acquisition: last.map(|(at, figure_name)| MilestoneRef { at, figure_name }),
    })
}

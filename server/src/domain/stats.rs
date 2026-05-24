//! Collection statistics — MangaCollector-style aggregates for the signed-in user.
//!
//! Computed lazily on `GET /api/me/stats`. The query set is intentionally
//! independent from Year-in-Review (which is a single year's poster); these
//! stats span the entire collection lifetime and are the kind of breakdown
//! a collector wants to see when they ask "what does my shelf look like?".
//!
//! All aggregates are scoped to `user_id`. We keep this in raw sqlx — the
//! schema joins (owned_items ↔ figures ↔ manufacturers ↔ series) lean
//! heavily on free-form SQL features (FILTER, percentile_cont, EXTRACT) that
//! sea-orm hides poorly.

use crate::error::AppResult;
use chrono::NaiveDate;
use rust_decimal::Decimal;
use serde::Serialize;
use sqlx::PgPool;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize)]
pub struct CollectionStats {
    /// Total figurines in the collection.
    pub total_pieces: i64,
    /// Number of distinct figure_type values represented.
    pub distinct_types: i64,
    /// Number of distinct manufacturers represented.
    pub distinct_manufacturers: i64,
    /// Number of distinct series represented (figures with at least one series tag).
    pub distinct_series: i64,
    /// Number of scans created by the user across their collection (turntable + gsplat).
    pub total_scans: i64,
    /// Pre-order summary counters.
    pub preorders: PreorderSummary,
    /// Money spent breakdown by ISO 4217 currency.
    pub spend_by_currency: Vec<SpendBucket>,
    /// Counts by figure_type ("nendoroid", "scale", "figma", …), sorted desc.
    pub by_type: Vec<TypeBreakdown>,
    /// Counts by condition ("mib_sealed", "opened_box", "displayed", "loose", "damaged").
    pub by_condition: Vec<ConditionBreakdown>,
    /// Top manufacturers by piece count (max 10).
    pub top_manufacturers: Vec<NamedCount>,
    /// Top series by piece count (max 10).
    pub top_series: Vec<NamedCount>,
    /// Top sculptors by piece count (max 10).
    pub top_sculptors: Vec<NamedCount>,
    /// Pieces acquired per year (over the entire history).
    pub acquisitions_by_year: Vec<YearCount>,
    /// Highest-paid acquisition per currency.
    pub most_expensive: Vec<MostExpensive>,
    /// Average and median piece price per currency.
    pub price_distribution: Vec<PriceDistribution>,
}

#[derive(Debug, Clone, Serialize)]
pub struct PreorderSummary {
    pub placed: i64,
    pub received: i64,
    pub cancelled: i64,
    pub open: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct SpendBucket {
    pub currency: String,
    pub total: Decimal,
    pub pieces_priced: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct TypeBreakdown {
    pub figure_type: String,
    pub count: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct ConditionBreakdown {
    pub condition: String,
    pub count: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct NamedCount {
    pub name: String,
    pub count: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct YearCount {
    pub year: i32,
    pub count: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct MostExpensive {
    pub currency: String,
    pub price: Decimal,
    pub figure_id: Uuid,
    pub figure_name: String,
    pub purchase_date: Option<NaiveDate>,
}

#[derive(Debug, Clone, Serialize)]
pub struct PriceDistribution {
    pub currency: String,
    pub avg: Decimal,
    pub median: Decimal,
    pub min: Decimal,
    pub max: Decimal,
}

pub async fn collection_stats(pool: &PgPool, user_id: Uuid) -> AppResult<CollectionStats> {
    // ----- Headlines ---------------------------------------------------------
    let (total_pieces,): (i64,) =
        sqlx::query_as("SELECT COUNT(*)::bigint FROM owned_items WHERE user_id = $1")
            .bind(user_id)
            .fetch_one(pool)
            .await?;

    let (distinct_types,): (i64,) = sqlx::query_as(
        "SELECT COUNT(DISTINCT f.figure_type)::bigint
         FROM owned_items o JOIN figures f ON f.id = o.figure_id
         WHERE o.user_id = $1",
    )
    .bind(user_id)
    .fetch_one(pool)
    .await?;

    let (distinct_manufacturers,): (i64,) = sqlx::query_as(
        "SELECT COUNT(DISTINCT f.manufacturer_id)::bigint
         FROM owned_items o JOIN figures f ON f.id = o.figure_id
         WHERE o.user_id = $1 AND f.manufacturer_id IS NOT NULL",
    )
    .bind(user_id)
    .fetch_one(pool)
    .await?;

    let (distinct_series,): (i64,) = sqlx::query_as(
        "SELECT COUNT(DISTINCT fs.series_id)::bigint
         FROM owned_items o
         JOIN figure_series fs ON fs.figure_id = o.figure_id
         WHERE o.user_id = $1",
    )
    .bind(user_id)
    .fetch_one(pool)
    .await?;

    let (total_scans,): (i64,) = sqlx::query_as(
        "SELECT COUNT(*)::bigint FROM scans
         WHERE owned_item_id IN (SELECT id FROM owned_items WHERE user_id = $1)",
    )
    .bind(user_id)
    .fetch_one(pool)
    .await?;

    // ----- Pre-order summary -------------------------------------------------
    let preorder_rows: Vec<(String, i64)> = sqlx::query_as(
        "SELECT status, COUNT(*)::bigint
         FROM preorders WHERE user_id = $1
         GROUP BY status",
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?;
    let mut preorders = PreorderSummary {
        placed: 0,
        received: 0,
        cancelled: 0,
        open: 0,
    };
    for (status, count) in preorder_rows {
        preorders.placed += count;
        match status.as_str() {
            "received" => preorders.received = count,
            "cancelled" => preorders.cancelled = count,
            // any non-terminal status counts as "open" (placed/confirmed/shipping/…)
            _ => preorders.open += count,
        }
    }

    // ----- Spend by currency -------------------------------------------------
    let spend_rows: Vec<(String, Decimal, i64)> = sqlx::query_as(
        "SELECT price_currency,
                COALESCE(SUM(price_amount), 0)::numeric,
                COUNT(*)::bigint
         FROM owned_items
         WHERE user_id = $1
           AND price_amount IS NOT NULL
           AND price_currency IS NOT NULL
         GROUP BY price_currency
         ORDER BY 2 DESC",
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?;
    let spend_by_currency = spend_rows
        .into_iter()
        .map(|(currency, total, pieces_priced)| SpendBucket {
            currency,
            total,
            pieces_priced,
        })
        .collect();

    // ----- by_type -----------------------------------------------------------
    let type_rows: Vec<(String, i64)> = sqlx::query_as(
        "SELECT f.figure_type, COUNT(*)::bigint
         FROM owned_items o JOIN figures f ON f.id = o.figure_id
         WHERE o.user_id = $1
         GROUP BY f.figure_type
         ORDER BY 2 DESC, 1 ASC",
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?;
    let by_type = type_rows
        .into_iter()
        .map(|(figure_type, count)| TypeBreakdown { figure_type, count })
        .collect();

    // ----- by_condition ------------------------------------------------------
    let condition_rows: Vec<(String, i64)> = sqlx::query_as(
        "SELECT condition, COUNT(*)::bigint
         FROM owned_items
         WHERE user_id = $1
         GROUP BY condition
         ORDER BY 2 DESC",
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?;
    let by_condition = condition_rows
        .into_iter()
        .map(|(condition, count)| ConditionBreakdown { condition, count })
        .collect();

    // ----- Top manufacturers -------------------------------------------------
    let manufacturer_rows: Vec<(String, i64)> = sqlx::query_as(
        "SELECT m.name, COUNT(*)::bigint
         FROM owned_items o
         JOIN figures f       ON f.id = o.figure_id
         JOIN manufacturers m ON m.id = f.manufacturer_id
         WHERE o.user_id = $1
         GROUP BY m.name
         ORDER BY 2 DESC, 1 ASC
         LIMIT 10",
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?;
    let top_manufacturers = manufacturer_rows
        .into_iter()
        .map(|(name, count)| NamedCount { name, count })
        .collect();

    // ----- Top series --------------------------------------------------------
    let series_rows: Vec<(String, i64)> = sqlx::query_as(
        "SELECT s.name, COUNT(*)::bigint
         FROM owned_items o
         JOIN figure_series fs ON fs.figure_id = o.figure_id
         JOIN series s         ON s.id        = fs.series_id
         WHERE o.user_id = $1
         GROUP BY s.name
         ORDER BY 2 DESC, 1 ASC
         LIMIT 10",
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?;
    let top_series = series_rows
        .into_iter()
        .map(|(name, count)| NamedCount { name, count })
        .collect();

    // ----- Top sculptors -----------------------------------------------------
    let sculptor_rows: Vec<(String, i64)> = sqlx::query_as(
        "SELECT sc.name, COUNT(*)::bigint
         FROM owned_items o
         JOIN figures f    ON f.id  = o.figure_id
         JOIN sculptors sc ON sc.id = f.sculptor_id
         WHERE o.user_id = $1
         GROUP BY sc.name
         ORDER BY 2 DESC, 1 ASC
         LIMIT 10",
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?;
    let top_sculptors = sculptor_rows
        .into_iter()
        .map(|(name, count)| NamedCount { name, count })
        .collect();

    // ----- Acquisitions by year ---------------------------------------------
    let year_rows: Vec<(i32, i64)> = sqlx::query_as(
        "SELECT EXTRACT(YEAR FROM COALESCE(purchase_date, created_at::date))::int,
                COUNT(*)::bigint
         FROM owned_items
         WHERE user_id = $1
         GROUP BY 1
         ORDER BY 1 ASC",
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?;
    let acquisitions_by_year = year_rows
        .into_iter()
        .map(|(year, count)| YearCount { year, count })
        .collect();

    // ----- Most expensive piece per currency --------------------------------
    let most_expensive_rows: Vec<(String, Decimal, Uuid, String, Option<NaiveDate>)> =
        sqlx::query_as(
            "SELECT DISTINCT ON (o.price_currency)
                    o.price_currency,
                    o.price_amount,
                    f.id,
                    f.name,
                    o.purchase_date
             FROM owned_items o
             JOIN figures f ON f.id = o.figure_id
             WHERE o.user_id = $1
               AND o.price_amount IS NOT NULL
               AND o.price_currency IS NOT NULL
             ORDER BY o.price_currency, o.price_amount DESC",
        )
        .bind(user_id)
        .fetch_all(pool)
        .await?;
    let most_expensive = most_expensive_rows
        .into_iter()
        .map(
            |(currency, price, figure_id, figure_name, purchase_date)| MostExpensive {
                currency,
                price,
                figure_id,
                figure_name,
                purchase_date,
            },
        )
        .collect();

    // ----- Price distribution (avg, median, min, max) ------------------------
    let price_rows: Vec<(String, Decimal, Decimal, Decimal, Decimal)> = sqlx::query_as(
        "SELECT price_currency,
                AVG(price_amount)::numeric,
                COALESCE(percentile_cont(0.5)
                  WITHIN GROUP (ORDER BY price_amount), 0)::numeric,
                MIN(price_amount)::numeric,
                MAX(price_amount)::numeric
         FROM owned_items
         WHERE user_id = $1
           AND price_amount IS NOT NULL
           AND price_currency IS NOT NULL
         GROUP BY price_currency
         ORDER BY 1",
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?;
    let price_distribution = price_rows
        .into_iter()
        .map(|(currency, avg, median, min, max)| PriceDistribution {
            currency,
            avg,
            median,
            min,
            max,
        })
        .collect();

    Ok(CollectionStats {
        total_pieces,
        distinct_types,
        distinct_manufacturers,
        distinct_series,
        total_scans,
        preorders,
        spend_by_currency,
        by_type,
        by_condition,
        top_manufacturers,
        top_series,
        top_sculptors,
        acquisitions_by_year,
        most_expensive,
        price_distribution,
    })
}

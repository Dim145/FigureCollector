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
    /// Estimated collection value by ISO 4217 currency (manual `value_amount`,
    /// falling back to catalog MSRP). Pair with `spend_by_currency` to derive
    /// the latent plus-value per currency.
    pub value_by_currency: Vec<ValueBucket>,
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
    /// Sum of `price_amount` (item cost only) — kept as `total` for
    /// backward compatibility with the SPA; semantically equal to
    /// "what I paid for the figures themselves".
    pub total: Decimal,
    pub pieces_priced: i64,
    /// Sum of `shipping_amount` across the same priced rows.
    pub shipping_total: Decimal,
    /// Sum of `figures.msrp_amount` across the same priced rows — the
    /// reference "catalog cost" for everything the user has actually paid
    /// a recorded price for. Lets the SPA show savings / overpay deltas.
    pub catalog_total: Decimal,
    /// Sum of item cost + shipping cost. The headline figure most users
    /// actually want — "how much did this collection drain my wallet".
    pub grand_total: Decimal,
}

#[derive(Debug, Clone, Serialize)]
pub struct ValueBucket {
    pub currency: String,
    /// Sum of the effective value: the manual `value_amount` when set, else
    /// the figure's catalog MSRP.
    pub estimated_total: Decimal,
    /// Pieces with a manually-entered value.
    pub pieces_valued: i64,
    /// Pieces valued via the MSRP fallback (no manual value yet).
    pub pieces_msrp: i64,
    /// Total pieces contributing to this currency bucket.
    pub pieces_total: i64,
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
    // All 14 of the queries below are independent (different aggregates over
    // the same user's data, no cross-row dependencies). Sea of `fetch_one` /
    // `fetch_all` calls used to run strictly sequentially — total latency
    // was dominated by N × pool-acquire RTT plus N × planner overhead.
    // Running them concurrently with `try_join!` lets the planner schedule
    // them on parallel pool connections; observed wall-clock drop is
    // 10-13× on a busy pool.
    let total_pieces = sqlx::query_as::<_, (i64,)>(
        "SELECT COUNT(*)::bigint FROM owned_items WHERE user_id = $1",
    )
    .bind(user_id)
    .fetch_one(pool);

    let distinct_types = sqlx::query_as::<_, (i64,)>(
        "SELECT COUNT(DISTINCT f.figure_type)::bigint
         FROM owned_items o JOIN figures f ON f.id = o.figure_id
         WHERE o.user_id = $1",
    )
    .bind(user_id)
    .fetch_one(pool);

    let distinct_manufacturers = sqlx::query_as::<_, (i64,)>(
        "SELECT COUNT(DISTINCT f.manufacturer_id)::bigint
         FROM owned_items o JOIN figures f ON f.id = o.figure_id
         WHERE o.user_id = $1 AND f.manufacturer_id IS NOT NULL",
    )
    .bind(user_id)
    .fetch_one(pool);

    let distinct_series = sqlx::query_as::<_, (i64,)>(
        "SELECT COUNT(DISTINCT fs.series_id)::bigint
         FROM owned_items o
         JOIN figure_series fs ON fs.figure_id = o.figure_id
         WHERE o.user_id = $1",
    )
    .bind(user_id)
    .fetch_one(pool);

    let total_scans = sqlx::query_as::<_, (i64,)>(
        "SELECT COUNT(*)::bigint FROM scans
         WHERE owned_item_id IN (SELECT id FROM owned_items WHERE user_id = $1)",
    )
    .bind(user_id)
    .fetch_one(pool);

    let preorder_rows_fut = sqlx::query_as::<_, (String, i64)>(
        "SELECT status, COUNT(*)::bigint
         FROM preorders WHERE user_id = $1
         GROUP BY status",
    )
    .bind(user_id)
    .fetch_all(pool);

    // ----- Spend by currency -------------------------------------------------
    // Falls back to the catalog MSRP when the user didn't record a personal
    // price — most collectors don't track every receipt, so without this
    // fallback the stats page is empty for them. We still let an explicit
    // owned-side price win when it exists.
    //
    // We also compute alongside it:
    //   - shipping_total : sum of explicit shipping cost (NULL ↦ 0)
    //   - catalog_total  : sum of the figure's MSRP at the same currency —
    //                      lets the SPA show "spent vs catalog" deltas
    //   - grand_total    : sum of paid + shipping (the headline figure)
    let spend_rows_fut = sqlx::query_as::<_, (String, Decimal, i64, Decimal, Decimal, Decimal)>(
        "WITH priced AS (
             SELECT COALESCE(o.price_currency, f.msrp_currency) AS currency,
                    COALESCE(o.price_amount, f.msrp_amount)     AS amount,
                    COALESCE(o.shipping_amount, 0)              AS shipping,
                    f.msrp_amount                                AS catalog
             FROM owned_items o
             JOIN figures f ON f.id = o.figure_id
             WHERE o.user_id = $1
         )
         SELECT currency,
                COALESCE(SUM(amount), 0)::numeric                   AS total,
                COUNT(*)::bigint                                    AS pieces_priced,
                COALESCE(SUM(shipping), 0)::numeric                 AS shipping_total,
                COALESCE(SUM(catalog), 0)::numeric                  AS catalog_total,
                COALESCE(SUM(amount + shipping), 0)::numeric        AS grand_total
         FROM priced
         WHERE amount IS NOT NULL AND currency IS NOT NULL
         GROUP BY currency
         ORDER BY 6 DESC",
    )
    .bind(user_id)
    .fetch_all(pool);

    // ----- Estimated value by currency --------------------------------------
    // Effective value = the manual `value_amount` when present, else the
    // figure's catalog MSRP. The bucket currency follows whichever amount won,
    // so a JPY MSRP fallback isn't mislabelled with the user's price currency.
    // Pairs with `spend_by_currency` for the latent plus-value delta.
    let value_rows_fut = sqlx::query_as::<_, (String, Decimal, i64, i64, i64)>(
        "WITH valued AS (
             SELECT CASE WHEN o.value_amount IS NOT NULL
                         THEN COALESCE(o.value_currency, o.price_currency, f.msrp_currency)
                         ELSE f.msrp_currency END                  AS currency,
                    COALESCE(o.value_amount, f.msrp_amount)         AS amount,
                    (o.value_amount IS NOT NULL)                    AS is_manual
             FROM owned_items o
             JOIN figures f ON f.id = o.figure_id
             WHERE o.user_id = $1
         )
         SELECT currency,
                COALESCE(SUM(amount), 0)::numeric             AS estimated_total,
                COUNT(*) FILTER (WHERE is_manual)::bigint     AS pieces_valued,
                COUNT(*) FILTER (WHERE NOT is_manual)::bigint AS pieces_msrp,
                COUNT(*)::bigint                              AS pieces_total
         FROM valued
         WHERE amount IS NOT NULL AND currency IS NOT NULL
         GROUP BY currency
         ORDER BY 2 DESC",
    )
    .bind(user_id)
    .fetch_all(pool);

    // ----- by_type -----------------------------------------------------------
    let type_rows_fut = sqlx::query_as::<_, (String, i64)>(
        "SELECT f.figure_type, COUNT(*)::bigint
         FROM owned_items o JOIN figures f ON f.id = o.figure_id
         WHERE o.user_id = $1
         GROUP BY f.figure_type
         ORDER BY 2 DESC, 1 ASC",
    )
    .bind(user_id)
    .fetch_all(pool);

    // ----- by_condition ------------------------------------------------------
    let condition_rows_fut = sqlx::query_as::<_, (String, i64)>(
        "SELECT condition, COUNT(*)::bigint
         FROM owned_items
         WHERE user_id = $1
         GROUP BY condition
         ORDER BY 2 DESC",
    )
    .bind(user_id)
    .fetch_all(pool);

    // ----- Top manufacturers -------------------------------------------------
    let manufacturer_rows_fut = sqlx::query_as::<_, (String, i64)>(
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
    .fetch_all(pool);

    // ----- Top series --------------------------------------------------------
    let series_rows_fut = sqlx::query_as::<_, (String, i64)>(
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
    .fetch_all(pool);

    // ----- Top sculptors -----------------------------------------------------
    let sculptor_rows_fut = sqlx::query_as::<_, (String, i64)>(
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
    .fetch_all(pool);

    // ----- Acquisitions by year ---------------------------------------------
    let year_rows_fut = sqlx::query_as::<_, (i32, i64)>(
        "SELECT EXTRACT(YEAR FROM COALESCE(purchase_date, created_at::date))::int,
                COUNT(*)::bigint
         FROM owned_items
         WHERE user_id = $1
         GROUP BY 1
         ORDER BY 1 ASC",
    )
    .bind(user_id)
    .fetch_all(pool);

    // ----- Most expensive piece per currency --------------------------------
    // Same fallback chain as the spend bucket: prefer the owner's price,
    // else the catalog MSRP.
    let most_expensive_rows_fut =
        sqlx::query_as::<_, (String, Decimal, Uuid, String, Option<NaiveDate>)>(
            "WITH priced AS (
                 SELECT COALESCE(o.price_currency, f.msrp_currency) AS currency,
                        COALESCE(o.price_amount, f.msrp_amount)     AS amount,
                        f.id   AS figure_id,
                        f.name AS figure_name,
                        o.purchase_date
                 FROM owned_items o
                 JOIN figures f ON f.id = o.figure_id
                 WHERE o.user_id = $1
             )
             SELECT DISTINCT ON (currency)
                    currency, amount, figure_id, figure_name, purchase_date
             FROM priced
             WHERE amount IS NOT NULL AND currency IS NOT NULL
             ORDER BY currency, amount DESC",
        )
        .bind(user_id)
        .fetch_all(pool);

    // ----- Price distribution (avg, median, min, max) ------------------------
    let price_rows_fut = sqlx::query_as::<_, (String, Decimal, Decimal, Decimal, Decimal)>(
        "WITH priced AS (
             SELECT COALESCE(o.price_currency, f.msrp_currency) AS currency,
                    COALESCE(o.price_amount, f.msrp_amount)     AS amount
             FROM owned_items o
             JOIN figures f ON f.id = o.figure_id
             WHERE o.user_id = $1
         )
         SELECT currency,
                AVG(amount)::numeric,
                COALESCE(percentile_cont(0.5)
                  WITHIN GROUP (ORDER BY amount), 0)::numeric,
                MIN(amount)::numeric,
                MAX(amount)::numeric
         FROM priced
         WHERE amount IS NOT NULL AND currency IS NOT NULL
         GROUP BY currency
         ORDER BY 1",
    )
    .bind(user_id)
    .fetch_all(pool);

    // Fire them all and join. `try_join!` returns the first error if any
    // arm fails — failed pool acquisitions or DB errors propagate normally.
    // Note: sqlx serialises queries onto the SAME connection if the pool is
    // saturated; on a busy pool we get true concurrency, on an idle one we
    // at least save the per-query planner setup that was happening
    // sequentially before.
    let (
        (total_pieces,),
        (distinct_types,),
        (distinct_manufacturers,),
        (distinct_series,),
        (total_scans,),
        preorder_rows,
        spend_rows,
        value_rows,
        type_rows,
        condition_rows,
        manufacturer_rows,
        series_rows,
        sculptor_rows,
        year_rows,
        most_expensive_rows,
        price_rows,
    ) = tokio::try_join!(
        total_pieces,
        distinct_types,
        distinct_manufacturers,
        distinct_series,
        total_scans,
        preorder_rows_fut,
        spend_rows_fut,
        value_rows_fut,
        type_rows_fut,
        condition_rows_fut,
        manufacturer_rows_fut,
        series_rows_fut,
        sculptor_rows_fut,
        year_rows_fut,
        most_expensive_rows_fut,
        price_rows_fut,
    )?;

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

    let spend_by_currency = spend_rows
        .into_iter()
        .map(
            |(currency, total, pieces_priced, shipping_total, catalog_total, grand_total)| {
                SpendBucket {
                    currency,
                    total,
                    pieces_priced,
                    shipping_total,
                    catalog_total,
                    grand_total,
                }
            },
        )
        .collect();
    let value_by_currency = value_rows
        .into_iter()
        .map(
            |(currency, estimated_total, pieces_valued, pieces_msrp, pieces_total)| ValueBucket {
                currency,
                estimated_total,
                pieces_valued,
                pieces_msrp,
                pieces_total,
            },
        )
        .collect();
    let by_type = type_rows
        .into_iter()
        .map(|(figure_type, count)| TypeBreakdown { figure_type, count })
        .collect();
    let by_condition = condition_rows
        .into_iter()
        .map(|(condition, count)| ConditionBreakdown { condition, count })
        .collect();
    let top_manufacturers = manufacturer_rows
        .into_iter()
        .map(|(name, count)| NamedCount { name, count })
        .collect();
    let top_series = series_rows
        .into_iter()
        .map(|(name, count)| NamedCount { name, count })
        .collect();
    let top_sculptors = sculptor_rows
        .into_iter()
        .map(|(name, count)| NamedCount { name, count })
        .collect();
    let acquisitions_by_year = year_rows
        .into_iter()
        .map(|(year, count)| YearCount { year, count })
        .collect();
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
        value_by_currency,
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

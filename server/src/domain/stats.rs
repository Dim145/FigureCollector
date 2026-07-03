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
    /// Everything normalised to a single EUR figure (pricing refonte): cost at
    /// the rate frozen at purchase, value at today's rate, plus-value as their
    /// difference. `None` when the rate table is momentarily unavailable — the
    /// SPA then falls back to the per-currency buckets above.
    pub eur: Option<EurTotals>,
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
    /// Sum of the effective value: the manual `value_amount` when set, else the
    /// auto-fetched provider price, else the figure's catalog MSRP.
    pub estimated_total: Decimal,
    /// Pieces with a manually-entered value.
    pub pieces_valued: i64,
    /// Pieces valued via the auto-fetched provider price (no manual value yet).
    pub pieces_auto: i64,
    /// Pieces valued via the MSRP fallback (no manual value, no provider price).
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

#[derive(Debug, Clone, Serialize)]
pub struct EurTotals {
    /// Figure COST (price only, MSRP fallback; deposit is part of the price)
    /// normalised to EUR — each row at its frozen purchase-time rate, or
    /// today's rate when none was captured. EXCLUDES shipping: this is the
    /// plus-value basis (resale recovers a figure's value, not its shipping).
    pub cost: Decimal,
    /// Total OUTLAY (price + shipping) normalised to EUR — what actually left
    /// the wallet. Feeds the stats spend ledger, NOT the plus-value.
    pub spend: Decimal,
    /// Total estimated value normalised to EUR at today's rate.
    pub value: Decimal,
    /// `value - cost`: the latent plus-value in EUR. Compared against the
    /// figure cost (shipping excluded — a sunk cost the resale never recovers),
    /// and free of FX drift on the frozen cost side.
    pub plus_value: Decimal,
    /// Date of the rate table used for the today's-rate conversions.
    pub fx_date: String,
    /// True when some amount couldn't be converted (its currency was absent
    /// from the rate table) and was left out — the SPA marks the total approx.
    pub partial: bool,
}

pub async fn collection_stats(
    pool: &PgPool,
    http: &reqwest::Client,
    user_id: Uuid,
) -> AppResult<CollectionStats> {
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
                    -- Only count the catalog MSRP toward catalog_total when its
                    -- currency matches this row's bucket currency. Otherwise a
                    -- 150 EUR purchase of a figure with a 15800 JPY MSRP would
                    -- add 15800 to the EUR bucket, making the spent-vs-catalog
                    -- delta nonsense across currencies.
                    CASE WHEN f.msrp_currency = COALESCE(o.price_currency, f.msrp_currency)
                         THEN f.msrp_amount END                  AS catalog
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
    // auto-fetched provider price (price cron), else the figure's catalog MSRP.
    // The bucket currency follows whichever amount won, so a JPY MSRP fallback
    // isn't mislabelled with the user's price currency. `pieces_auto` counts
    // pieces resolved via the provider price. Pairs with `spend_by_currency`
    // for the latent plus-value delta.
    let value_rows_fut = sqlx::query_as::<_, (String, Decimal, i64, i64, i64, i64)>(
        "WITH valued AS (
             SELECT CASE
                        WHEN o.value_amount IS NOT NULL
                            THEN COALESCE(o.value_currency, o.price_currency, f.msrp_currency)
                        WHEN pp.amount IS NOT NULL
                            THEN COALESCE(pp.currency, f.msrp_currency)
                        ELSE f.msrp_currency END                       AS currency,
                    COALESCE(o.value_amount, pp.amount, f.msrp_amount)  AS amount,
                    (o.value_amount IS NOT NULL)                        AS is_manual,
                    (o.value_amount IS NULL AND pp.amount IS NOT NULL)  AS is_auto
             FROM owned_items o
             JOIN figures f ON f.id = o.figure_id
             LEFT JOIN figure_provider_prices pp ON pp.figure_id = o.figure_id
             WHERE o.user_id = $1
         )
         SELECT currency,
                COALESCE(SUM(amount), 0)::numeric                              AS estimated_total,
                COUNT(*) FILTER (WHERE is_manual)::bigint                      AS pieces_valued,
                COUNT(*) FILTER (WHERE is_auto)::bigint                        AS pieces_auto,
                COUNT(*) FILTER (WHERE NOT is_manual AND NOT is_auto)::bigint  AS pieces_msrp,
                COUNT(*)::bigint                                               AS pieces_total
         FROM valued
         WHERE amount IS NOT NULL AND currency IS NOT NULL
         GROUP BY currency
         ORDER BY 2 DESC",
    )
    .bind(user_id)
    .fetch_all(pool);

    // ----- Cost rows for EUR normalisation -----------------------------------
    // One row per owned item with a recorded cost (price, else MSRP) + shipping,
    // carrying the per-row FROZEN rate captured at purchase. The EUR spend total
    // is summed in Rust below: frozen rate where present, today's rate as the
    // graceful fallback for rows saved before the column existed. Mirrors the
    // spend-bucket cost basis so the two stay consistent.
    let eur_cost_rows_fut = sqlx::query_as::<_, (String, Decimal, Decimal, Option<Decimal>)>(
        "SELECT COALESCE(o.price_currency, f.msrp_currency)          AS currency,
                COALESCE(o.price_amount, f.msrp_amount)::numeric     AS amount,
                COALESCE(o.shipping_amount, 0)::numeric              AS shipping,
                o.price_fx_rate
         FROM owned_items o
         JOIN figures f ON f.id = o.figure_id
         WHERE o.user_id = $1
           AND COALESCE(o.price_amount, f.msrp_amount) IS NOT NULL
           AND COALESCE(o.price_currency, f.msrp_currency) IS NOT NULL",
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
        eur_cost_rows,
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
        eur_cost_rows_fut,
    )?;

    let mut preorders = PreorderSummary {
        placed: 0,
        received: 0,
        cancelled: 0,
        open: 0,
    };
    for (status, count) in preorder_rows {
        match status.as_str() {
            "received" => preorders.received = count,
            "cancelled" => preorders.cancelled = count,
            // any non-terminal status is an active pre-order the user placed —
            // counts toward both "placed" and "open" (placed/confirmed/shipping/…)
            _ => {
                preorders.placed += count;
                preorders.open += count;
            }
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
    let value_by_currency: Vec<ValueBucket> = value_rows
        .into_iter()
        .map(
            |(currency, estimated_total, pieces_valued, pieces_auto, pieces_msrp, pieces_total)| {
                ValueBucket {
                    currency,
                    estimated_total,
                    pieces_valued,
                    pieces_auto,
                    pieces_msrp,
                    pieces_total,
                }
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

    // EUR-normalised totals (pricing refonte): cost at the rate frozen when it
    // was recorded — today's rate as a graceful fallback for rows saved before
    // the price_fx_rate column existed — and value at today's rate. Computing
    // it here, where the per-row frozen rate lives, keeps the plus-value free
    // of FX drift on the cost side. Resilient: if the rate table can't be
    // fetched, `eur` is None and the SPA falls back to the per-currency buckets.
    let eur = match crate::external::fx::latest(pool, http, "EUR").await {
        Ok(rates) => {
            let mut cost = Decimal::ZERO;
            let mut spend = Decimal::ZERO;
            let mut value = Decimal::ZERO;
            let mut partial = false;
            for (currency, amount, shipping, frozen) in &eur_cost_rows {
                // Convert via the rate frozen at purchase (today's as fallback);
                // shipping shares the row's currency + frozen rate.
                let to_eur = |v: Decimal| match frozen {
                    Some(rate) if *rate > Decimal::ZERO => Some(v / *rate),
                    _ => rates.convert_to_base(v, currency),
                };
                match to_eur(*amount) {
                    Some(price_eur) => {
                        cost += price_eur;
                        spend += price_eur + to_eur(*shipping).unwrap_or(Decimal::ZERO);
                    }
                    None => partial = true,
                }
            }
            for bucket in &value_by_currency {
                match rates.convert_to_base(bucket.estimated_total, &bucket.currency) {
                    Some(v) => value += v,
                    None => partial = true,
                }
            }
            Some(EurTotals {
                cost,
                spend,
                value,
                plus_value: value - cost,
                fx_date: rates.date,
                partial,
            })
        }
        Err(_) => None,
    };

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
        eur,
    })
}

// =============================================================================
// Insights (Lot 5) — the deeper cuts that collection_stats didn't cover.
// Kept as a separate endpoint (`GET /api/me/insights`) so the headline stats
// query stays untouched and each surface can load independently.
// =============================================================================

#[derive(Debug, Clone, Serialize)]
pub struct Insights {
    /// Money spent per year, per currency (mirrors acquisitions_by_year but on
    /// the effective price — owned price, else catalog MSRP).
    pub spend_by_year: Vec<YearCurrencySpend>,
    /// Series the user owns part of, ranked by completion %. Singleton series
    /// (catalog total < 2) are excluded — 1/1 = 100% is noise.
    pub series_completion: Vec<SeriesCompletion>,
    /// Estimated cost to clear the wishlist, per currency (target price, else
    /// catalog MSRP).
    pub wishlist_value: Vec<CurrencyAmount>,
    pub wishlist_count: i64,
    pub preorder_health: PreorderHealth,
    /// "Collection DNA" — the appearance tags recurring most across the user's
    /// owned figures (generic tags dropped, popular-first). Empty until the
    /// WD-Tagger has indexed the collection.
    pub collection_dna: Vec<crate::domain::tags::TagFacet>,
    /// Owned figures carrying at least one tag — the share denominator the SPA
    /// pairs with each `collection_dna` count.
    pub dna_pieces: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct YearCurrencySpend {
    pub year: i32,
    pub currency: String,
    pub total: Decimal,
}

#[derive(Debug, Clone, Serialize)]
pub struct SeriesCompletion {
    pub series_id: Uuid,
    pub name: String,
    pub owned: i64,
    pub total: i64,
    pub pct: i32,
}

#[derive(Debug, Clone, Serialize)]
pub struct CurrencyAmount {
    pub currency: String,
    pub amount: Decimal,
}

#[derive(Debug, Clone, Serialize)]
pub struct PreorderHealth {
    /// Deposits locked in on still-open preorders (status not received/cancelled).
    pub deposits: Vec<CurrencyAmount>,
    /// Average slip in days over open preorders that slipped (NULL → none yet).
    pub avg_slip_days: Option<i64>,
    pub open: i64,
    pub cancellations: i64,
}

pub async fn insights(pool: &PgPool, user_id: Uuid) -> AppResult<Insights> {
    // ----- spend by year (per currency) -------------------------------------
    let spend_year_rows: Vec<(i32, String, Decimal)> = sqlx::query_as(
        "SELECT EXTRACT(YEAR FROM COALESCE(o.purchase_date, o.created_at::date))::int AS year,
                COALESCE(o.price_currency, f.msrp_currency)                           AS currency,
                COALESCE(SUM(COALESCE(o.price_amount, f.msrp_amount)), 0)::numeric     AS total
         FROM owned_items o
         JOIN figures f ON f.id = o.figure_id
         WHERE o.user_id = $1
           AND COALESCE(o.price_amount, f.msrp_amount) IS NOT NULL
           AND COALESCE(o.price_currency, f.msrp_currency) IS NOT NULL
         GROUP BY year, currency
         ORDER BY year ASC",
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?;
    let spend_by_year = spend_year_rows
        .into_iter()
        .map(|(year, currency, total)| YearCurrencySpend {
            year,
            currency,
            total,
        })
        .collect();

    // ----- series completion (owned vs catalog total) ----------------------
    let completion_rows: Vec<(Uuid, String, i64, i64, i32)> = sqlx::query_as(
        "WITH owned_s AS (
             SELECT fs.series_id, COUNT(DISTINCT f.id)::bigint AS owned
             FROM owned_items o
             JOIN figures f       ON f.id = o.figure_id
             JOIN figure_series fs ON fs.figure_id = f.id
             WHERE o.user_id = $1
             GROUP BY fs.series_id
         ),
         tot AS (
             SELECT series_id, COUNT(DISTINCT figure_id)::bigint AS total
             FROM figure_series
             GROUP BY series_id
         )
         SELECT s.id AS series_id, s.name, os.owned, t.total,
                ROUND(100.0 * os.owned / NULLIF(t.total, 0))::int AS pct
         FROM owned_s os
         JOIN tot t  ON t.series_id = os.series_id
         JOIN series s ON s.id = os.series_id
         WHERE t.total >= 2
         ORDER BY pct DESC, t.total DESC, s.name ASC
         LIMIT 8",
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?;
    let series_completion = completion_rows
        .into_iter()
        .map(|(series_id, name, owned, total, pct)| SeriesCompletion {
            series_id,
            name,
            owned,
            total,
            pct,
        })
        .collect();

    // ----- wishlist value + count -------------------------------------------
    let wishlist_rows: Vec<(String, Decimal)> = sqlx::query_as(
        "SELECT COALESCE(w.max_price_currency, f.msrp_currency)                       AS currency,
                COALESCE(SUM(COALESCE(w.max_price_amount, f.msrp_amount)), 0)::numeric AS amount
         FROM wishlist_items w
         JOIN figures f ON f.id = w.figure_id
         WHERE w.user_id = $1
           AND COALESCE(w.max_price_amount, f.msrp_amount) IS NOT NULL
           AND COALESCE(w.max_price_currency, f.msrp_currency) IS NOT NULL
         GROUP BY currency
         ORDER BY amount DESC",
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?;
    let wishlist_value = wishlist_rows
        .into_iter()
        .map(|(currency, amount)| CurrencyAmount { currency, amount })
        .collect();
    let (wishlist_count,): (i64,) =
        sqlx::query_as("SELECT COUNT(*)::bigint FROM wishlist_items WHERE user_id = $1")
            .bind(user_id)
            .fetch_one(pool)
            .await?;

    // ----- preorder health ---------------------------------------------------
    let deposit_rows: Vec<(String, Decimal)> = sqlx::query_as(
        "SELECT price_currency AS currency, COALESCE(SUM(deposit_amount), 0)::numeric AS amount
         FROM preorders
         WHERE user_id = $1
           AND status NOT IN ('received', 'cancelled')
           AND deposit_amount IS NOT NULL
           AND price_currency IS NOT NULL
         GROUP BY price_currency
         ORDER BY amount DESC",
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?;
    let (avg_slip, open, cancellations): (Option<f64>, i64, i64) = sqlx::query_as(
        "SELECT
            (AVG(release_date_current - release_date_original)
                FILTER (WHERE release_date_current > release_date_original
                          AND status NOT IN ('received', 'cancelled')))::float8 AS avg_slip,
            COUNT(*) FILTER (WHERE status NOT IN ('received', 'cancelled'))      AS open,
            COUNT(*) FILTER (WHERE status = 'cancelled')                        AS cancellations
         FROM preorders WHERE user_id = $1",
    )
    .bind(user_id)
    .fetch_one(pool)
    .await?;

    // ----- collection DNA (top appearance tags among owned figures) ---------
    let (collection_dna, dna_pieces) = crate::domain::tags::collection_dna(pool, user_id, 16).await?;

    Ok(Insights {
        spend_by_year,
        series_completion,
        wishlist_value,
        wishlist_count,
        collection_dna,
        dna_pieces,
        preorder_health: PreorderHealth {
            deposits: deposit_rows
                .into_iter()
                .map(|(currency, amount)| CurrencyAmount { currency, amount })
                .collect(),
            avg_slip_days: avg_slip.map(|d| d.round() as i64),
            open,
            cancellations,
        },
    })
}

// =============================================================================
// Collection over time (#10) — the growth curve, reconstructed from existing
// data (NO dedicated table). Each non-archived owned_item carries a date
// (purchase_date, else created_at) and a paid amount (price_amount, else the
// catalog MSRP fallback used everywhere else in this module) + shipping, in
// `price_currency`. We bucket by calendar month and currency; the SPA turns the
// per-month/per-currency deltas into a cumulative items + cumulative spend
// curve, converting spend through the Money/DisplayCurrency layer. Spend stays
// PER-CURRENCY here — never cross-converted server-side (no rate drift, and the
// client owns the single display currency).
// =============================================================================

#[derive(Debug, Clone, Serialize)]
pub struct TimelineBucket {
    /// Calendar month, `YYYY-MM` (e.g. "2026-06").
    pub month: String,
    /// ISO 4217 currency of `spend_added`.
    pub currency: String,
    /// Pieces whose effective date falls in this month + currency bucket.
    pub items_added: i64,
    /// Outlay added in this month + currency: SUM(price + shipping), MSRP
    /// fallback when no personal price — mirrors `spend_by_currency.grand_total`.
    pub spend_added: Decimal,
}

/// Monthly buckets of pieces + outlay over the user's NON-ARCHIVED collection,
/// grouped by month and currency, oldest month first. Rows with no date at all
/// (no purchase_date AND no created_at — impossible in practice, created_at is
/// NOT NULL) are skipped via the WHERE guard. Items priced in a currency are
/// counted in that bucket; an item with no recordable amount/currency at all
/// still counts toward `items_added` but contributes 0 spend (so the item curve
/// stays honest even when a piece has no price).
pub async fn collection_timeline(pool: &PgPool, user_id: Uuid) -> AppResult<Vec<TimelineBucket>> {
    // Two facets per month: the item count (every non-archived piece, regardless
    // of price) and the per-currency outlay (priced pieces only). We compute the
    // currency bucket once (COALESCE owned→catalog), then split the item count
    // across two sources so an unpriced piece still increments items_added under
    // a synthetic '∅' currency bucket the SPA folds into the item curve.
    let rows: Vec<(String, String, i64, Decimal)> = sqlx::query_as(
        "WITH dated AS (
             SELECT to_char(date_trunc('month',
                        COALESCE(o.purchase_date, o.created_at::date)), 'YYYY-MM') AS month,
                    COALESCE(o.price_currency, f.msrp_currency)                    AS currency,
                    COALESCE(o.price_amount, f.msrp_amount)                        AS amount,
                    COALESCE(o.shipping_amount, 0)                                 AS shipping
             FROM owned_items o
             JOIN figures f ON f.id = o.figure_id
             WHERE o.user_id = $1
               AND o.archived_at IS NULL
               AND COALESCE(o.purchase_date, o.created_at::date) IS NOT NULL
         )
         SELECT month,
                COALESCE(currency, '')                                  AS currency,
                COUNT(*)::bigint                                        AS items_added,
                COALESCE(SUM(CASE WHEN amount IS NOT NULL
                                  THEN amount + shipping END), 0)::numeric AS spend_added
         FROM dated
         GROUP BY month, COALESCE(currency, '')
         ORDER BY month ASC, currency ASC",
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|(month, currency, items_added, spend_added)| TimelineBucket {
            month,
            currency,
            items_added,
            spend_added,
        })
        .collect())
}

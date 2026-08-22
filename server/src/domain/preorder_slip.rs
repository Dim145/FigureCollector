//! Slip statistics — how late a maker's pre-orders actually run.
//!
//! Every date change on a pre-order is already journaled in
//! `preorder_date_history` (previous → new, with a source), but it was only
//! ever read back as a per-piece log. Aggregated, the same rows answer the
//! question that decides whether to pre-order at all: *this maker has slipped
//! a median of ten weeks across your last six pre-orders.*
//!
//! **On sample size.** A single-user instance holds tens of pre-orders, not
//! thousands, so a per-(maker × shop) split would routinely compute a "median"
//! from one observation. We therefore aggregate per **maker only**, refuse to
//! report below [`MIN_SAMPLES`], and always return the sample count so the UI
//! can show *n* next to the figure. An honest "not enough data yet" beats a
//! confident number drawn from one slip.

use crate::error::AppResult;
use serde::Serialize;
use sqlx::{FromRow, PgPool};
use uuid::Uuid;

/// Below this many observed slips we report nothing for a maker — a median of
/// one or two data points is noise wearing a statistic's clothes.
pub const MIN_SAMPLES: i64 = 3;

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct SlipStat {
    pub manufacturer_id: Option<Uuid>,
    pub manufacturer_name: Option<String>,
    /// Number of observed forward slips backing the figures below.
    pub samples: i64,
    /// Median slip, in days.
    pub median_days: Option<f64>,
    /// 80th-percentile slip, in days — the "plan for this" number.
    pub p80_days: Option<f64>,
    /// Worst single slip observed, in days.
    pub max_days: Option<f64>,
}

/// Per-maker slip stats for one user's pre-order history, worst P80 first.
/// Only *forward* moves count: a date pulled earlier is good news, not slip,
/// and averaging the two would cancel out exactly the risk we're measuring.
pub async fn per_manufacturer(pool: &PgPool, user_id: Uuid) -> AppResult<Vec<SlipStat>> {
    Ok(sqlx::query_as::<_, SlipStat>(
        "SELECT m.id   AS manufacturer_id,
                m.name AS manufacturer_name,
                count(*) AS samples,
                percentile_cont(0.5) WITHIN GROUP (
                    ORDER BY (h.new_date - h.previous_date)::double precision
                ) AS median_days,
                percentile_cont(0.8) WITHIN GROUP (
                    ORDER BY (h.new_date - h.previous_date)::double precision
                ) AS p80_days,
                max(h.new_date - h.previous_date)::double precision AS max_days
         FROM preorder_date_history h
         JOIN preorders   p ON p.id = h.preorder_id
         JOIN owned_items o ON o.id = p.owned_item_id
         JOIN figures     f ON f.id = o.figure_id
         LEFT JOIN manufacturers m ON m.id = f.manufacturer_id
         WHERE o.user_id = $1
           AND h.previous_date IS NOT NULL
           AND h.new_date IS NOT NULL
           AND h.new_date > h.previous_date
         GROUP BY m.id, m.name
         HAVING count(*) >= $2
         ORDER BY p80_days DESC NULLS LAST, samples DESC",
    )
    .bind(user_id)
    .bind(MIN_SAMPLES)
    .fetch_all(pool)
    .await?)
}

/// One overall row across every maker — what a young instance can still say
/// while no single maker has reached [`MIN_SAMPLES`].
pub async fn overall(pool: &PgPool, user_id: Uuid) -> AppResult<SlipStat> {
    let row: Option<SlipStat> = sqlx::query_as::<_, SlipStat>(
        "SELECT NULL::uuid AS manufacturer_id,
                NULL::text AS manufacturer_name,
                count(*) AS samples,
                percentile_cont(0.5) WITHIN GROUP (
                    ORDER BY (h.new_date - h.previous_date)::double precision
                ) AS median_days,
                percentile_cont(0.8) WITHIN GROUP (
                    ORDER BY (h.new_date - h.previous_date)::double precision
                ) AS p80_days,
                max(h.new_date - h.previous_date)::double precision AS max_days
         FROM preorder_date_history h
         JOIN preorders   p ON p.id = h.preorder_id
         JOIN owned_items o ON o.id = p.owned_item_id
         WHERE o.user_id = $1
           AND h.previous_date IS NOT NULL
           AND h.new_date IS NOT NULL
           AND h.new_date > h.previous_date",
    )
    .bind(user_id)
    .fetch_optional(pool)
    .await?;
    Ok(row.unwrap_or(SlipStat {
        manufacturer_id: None,
        manufacturer_name: None,
        samples: 0,
        median_days: None,
        p80_days: None,
        max_days: None,
    }))
}

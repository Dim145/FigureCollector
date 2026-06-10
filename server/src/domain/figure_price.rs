//! Auto-fetched provider / market prices.
//!
//! Two tables, both written here by [`crate::services::price_cron`]:
//!
//!   - `figure_provider_prices` — the LATEST price per figure (PK
//!     `figure_id`, overwritten on refresh). Read by the cote/value
//!     computations in [`crate::domain::stats`] and [`crate::domain::owned`],
//!     where it sits as a fallback *under* the user's manual valuation and
//!     *above* the catalog MSRP.
//!   - `figure_price_history` — append-only change points (a row is added
//!     only when the scraped price differs from the last recorded one), kept
//!     for price-evolution graphs.

use crate::error::AppResult;
use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use serde::Serialize;
use sqlx::{FromRow, PgPool};
use uuid::Uuid;

/// One history point — a price *change* observed by the cron.
#[derive(Debug, Clone, Serialize, FromRow)]
pub struct PricePoint {
    pub amount: Decimal,
    pub currency: Option<String>,
    pub source: String,
    pub matched_version: Option<String>,
    pub recorded_at: DateTime<Utc>,
}

/// A history point tagged with its figure — the batch shape for "every point
/// across the figures the user owns" (one round-trip for the Cote page).
#[derive(Debug, Clone, Serialize, FromRow)]
pub struct OwnedPricePoint {
    pub figure_id: Uuid,
    pub amount: Decimal,
    pub currency: Option<String>,
    pub source: String,
    pub matched_version: Option<String>,
    pub recorded_at: DateTime<Utc>,
}

/// Chronological history for one figure, oldest first (chart order).
pub async fn history_for_figure(pool: &PgPool, figure_id: Uuid) -> AppResult<Vec<PricePoint>> {
    Ok(sqlx::query_as::<_, PricePoint>(
        "SELECT amount, currency, source, matched_version, recorded_at
         FROM figure_price_history
         WHERE figure_id = $1
         ORDER BY recorded_at ASC",
    )
    .bind(figure_id)
    .fetch_all(pool)
    .await?)
}

/// Chronological history for every figure the user owns, oldest first per
/// figure. Feeds the Cote page in one round-trip: per-row sparklines, the
/// expanded registres, and the client-side reconstructed collection curve.
pub async fn history_for_user_owned(
    pool: &PgPool,
    user_id: Uuid,
) -> AppResult<Vec<OwnedPricePoint>> {
    Ok(sqlx::query_as::<_, OwnedPricePoint>(
        "SELECT h.figure_id, h.amount, h.currency, h.source, h.matched_version, h.recorded_at
         FROM figure_price_history h
         WHERE h.figure_id IN (SELECT DISTINCT figure_id FROM owned_items WHERE user_id = $1)
         ORDER BY h.figure_id, h.recorded_at ASC",
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?)
}

/// Record one resolved provider price for a figure: upserts the "latest"
/// row AND appends a history point when the price changed — both in one
/// transaction, so an accepted price can never skip the history.
pub async fn upsert(
    pool: &PgPool,
    figure_id: Uuid,
    amount: Decimal,
    currency: Option<&str>,
    matched_version: Option<&str>,
    source: &str,
    source_url: Option<&str>,
) -> AppResult<()> {
    let mut tx = pool.begin().await?;

    // History point, deduped: skipped when this figure's most recent point
    // already carries the same amount + currency. Change points are enough to
    // chart a step curve, and a daily cron re-observing a stable price would
    // otherwise pile up identical rows. (`IS NOT DISTINCT FROM` makes a NULL
    // currency compare equal to NULL.)
    sqlx::query(
        "INSERT INTO figure_price_history
            (figure_id, amount, currency, source, matched_version)
         SELECT $1, $2, $3, $4, $5
         WHERE NOT EXISTS (
             SELECT 1 FROM (
                 SELECT amount, currency
                 FROM figure_price_history
                 WHERE figure_id = $1
                 ORDER BY recorded_at DESC
                 LIMIT 1
             ) last
             WHERE last.amount = $2
               AND last.currency IS NOT DISTINCT FROM $3
         )",
    )
    .bind(figure_id)
    .bind(amount)
    .bind(currency)
    .bind(source)
    .bind(matched_version)
    .execute(&mut *tx)
    .await?;

    sqlx::query(
        "INSERT INTO figure_provider_prices
            (figure_id, amount, currency, matched_version, source, source_url, fetched_at)
         VALUES ($1, $2, $3, $4, $5, $6, now())
         ON CONFLICT (figure_id) DO UPDATE SET
            amount          = EXCLUDED.amount,
            currency        = EXCLUDED.currency,
            matched_version = EXCLUDED.matched_version,
            source          = EXCLUDED.source,
            source_url      = EXCLUDED.source_url,
            fetched_at      = now()",
    )
    .bind(figure_id)
    .bind(amount)
    .bind(currency)
    .bind(matched_version)
    .bind(source)
    .bind(source_url)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok(())
}

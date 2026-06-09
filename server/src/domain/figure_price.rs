//! Auto-fetched provider / market prices, one row per figure.
//!
//! Populated by [`crate::services::price_cron`] (which scrapes each figure's
//! store buy-links) and read by the cote/value computations in
//! [`crate::domain::stats`] and [`crate::domain::owned`], where it sits as a
//! fallback *under* the user's manual valuation and *above* the catalog MSRP.

use crate::error::AppResult;
use rust_decimal::Decimal;
use sqlx::PgPool;
use uuid::Uuid;

/// Upsert the latest resolved provider price for one figure. PK is `figure_id`,
/// so every refresh overwrites the previous value (we keep "latest", not a
/// history).
pub async fn upsert(
    pool: &PgPool,
    figure_id: Uuid,
    amount: Decimal,
    currency: Option<&str>,
    matched_version: Option<&str>,
    source: &str,
    source_url: Option<&str>,
) -> AppResult<()> {
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
    .execute(pool)
    .await?;
    Ok(())
}

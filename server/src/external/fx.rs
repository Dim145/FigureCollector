//! Daily FX rates (ECB reference rates via frankfurter.dev) for the **optional,
//! display-only** currency-conversion overlay. The app never stores converted
//! amounts — money rows stay in their own currency (see `domain::stats`). This
//! is purely a convenience so a multi-currency collector can read one
//! approximate total.
//!
//! Cached ~12h in `external_lookups` (provider `fx`); one base fetch yields the
//! whole rate table. Free, keyless, HTTPS — and the SPA's manual overrides mean
//! the overlay still works if frankfurter is unreachable.

use crate::error::{AppError, AppResult};
use crate::external::cache;
use chrono::Duration;
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use std::collections::BTreeMap;

const CACHE_TTL_HOURS: i64 = 12;
const TIMEOUT_SECS: u64 = 15;

/// `rates[C]` = how many units of `C` equal 1 unit of `base` (frankfurter's
/// shape). The SPA converts an amount in `C` to `base` as `amount / rates[C]`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FxRates {
    pub base: String,
    pub date: String,
    pub rates: BTreeMap<String, f64>,
}

pub async fn latest(pool: &PgPool, http: &reqwest::Client, base: &str) -> AppResult<FxRates> {
    let base = base.to_uppercase();
    if base.len() != 3 || !base.chars().all(|c| c.is_ascii_alphabetic()) {
        return Err(AppError::BadRequest("base must be a 3-letter currency code"));
    }
    let http = http.clone();
    let key = base.clone();

    cache::cached_fetch::<FxRates, _, _>(
        pool,
        "fx",
        "latest",
        &key,
        Duration::hours(CACHE_TTL_HOURS),
        move || async move {
            let url = format!("https://api.frankfurter.dev/v1/latest?base={base}");
            let resp = http
                .get(&url)
                .header(
                    reqwest::header::USER_AGENT,
                    "FigureCollector/0.1 (+https://github.com/Dim145/FigureCollector)",
                )
                .timeout(std::time::Duration::from_secs(TIMEOUT_SECS))
                .send()
                .await
                .map_err(|e| AppError::Internal(anyhow::anyhow!("fx fetch failed: {e}")))?;
            if !resp.status().is_success() {
                return Err(AppError::Internal(anyhow::anyhow!(
                    "fx upstream returned HTTP {}",
                    resp.status()
                )));
            }
            resp.json::<FxRates>()
                .await
                .map_err(|e| AppError::Internal(anyhow::anyhow!("fx parse failed: {e}")))
        },
    )
    .await
}

impl FxRates {
    /// Convert `amount` (in `cur`) to the table's base currency, e.g.
    /// `amount / rates[cur]`. `cur == base` is the identity. Returns `None`
    /// when `cur` isn't covered (or its rate is non-positive), so callers can
    /// flag a total as partial rather than silently dropping the amount.
    pub fn convert_to_base(&self, amount: Decimal, cur: &str) -> Option<Decimal> {
        let cur = cur.trim().to_ascii_uppercase();
        if cur == self.base {
            return Some(amount);
        }
        let rate = Decimal::from_f64_retain(*self.rates.get(&cur)?)?;
        if rate <= Decimal::ZERO {
            return None;
        }
        Some(amount / rate)
    }
}

/// The rate to freeze when a cost is recorded: units of `cur` per 1 EUR right
/// now (EUR → 1). Stored on the row so the cost's EUR value is pinned to the
/// purchase-time rate. Returns `None` when rates are unavailable or `cur` isn't
/// covered — the caller stores NULL and display falls back to today's rate.
pub async fn freeze_rate_to_eur(
    pool: &PgPool,
    http: &reqwest::Client,
    cur: &str,
) -> Option<Decimal> {
    let cur = cur.trim().to_ascii_uppercase();
    if cur == "EUR" {
        return Some(Decimal::ONE);
    }
    let rates = latest(pool, http, "EUR").await.ok()?;
    Decimal::from_f64_retain(*rates.rates.get(&cur)?).filter(|d| *d > Decimal::ZERO)
}

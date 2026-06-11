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

// =============================================================================
// External-price normalisation (imports + price sweep)
// =============================================================================

/// An externally-scraped price normalised into a supported currency.
#[derive(Debug, Clone, PartialEq)]
pub struct NormalizedPrice {
    pub amount: Decimal,
    /// Always one of `domain::currency::SUPPORTED`.
    pub currency: String,
    /// `Some((amount, currency))` of the ORIGINAL price when a conversion
    /// happened (e.g. HK$ 500 → $ 64.10) — lets callers keep provenance in
    /// display strings.
    pub converted_from: Option<(Decimal, String)>,
    /// The source carried no usable currency, so USD was assumed (no
    /// conversion — the amount is taken as-is).
    pub assumed_usd: bool,
}

/// Normalise a scraped price into a supported currency (the import rule):
///
/// - **supported** currency → unchanged;
/// - **missing / unparseable** currency (`None`, symbols, free-form labels
///   like `"US Dollar"`) → **assumed USD**, amount untouched;
/// - **known but unsupported** (HKD, CNY, KRW…) → **converted to USD** at the
///   table's rate;
/// - **unconvertible** (a real code the ECB table doesn't cover, e.g. TWD) →
///   `None` — the caller drops the price rather than store a wrong amount.
///
/// Pure on a rate table so it's unit-testable; `rates` must be EUR-based.
pub fn normalize_with_rates(
    rates: &FxRates,
    amount: Decimal,
    currency: Option<&str>,
) -> Option<NormalizedPrice> {
    let shaped = currency
        .map(str::trim)
        .filter(|c| c.len() == 3 && c.bytes().all(|b| b.is_ascii_alphabetic()))
        .map(str::to_ascii_uppercase);
    let Some(cur) = shaped else {
        return Some(NormalizedPrice {
            amount,
            currency: "USD".into(),
            converted_from: None,
            assumed_usd: true,
        });
    };
    if crate::domain::currency::is_supported(&cur) {
        return Some(NormalizedPrice {
            amount,
            currency: cur,
            converted_from: None,
            assumed_usd: false,
        });
    }
    // Exotic but real: convert to USD through the EUR-based table.
    let per_eur_src = Decimal::from_f64_retain(*rates.rates.get(&cur)?)?;
    let per_eur_usd = Decimal::from_f64_retain(*rates.rates.get("USD")?)?;
    if per_eur_src <= Decimal::ZERO || per_eur_usd <= Decimal::ZERO {
        return None;
    }
    let converted = (amount / per_eur_src * per_eur_usd).round_dp(2);
    Some(NormalizedPrice {
        amount: converted,
        currency: "USD".into(),
        converted_from: Some((amount, cur)),
        assumed_usd: false,
    })
}

/// Async wrapper around [`normalize_with_rates`]: only fetches the (cached)
/// rate table when an actual conversion is needed; the common supported /
/// missing-currency cases never touch it. Returns `None` when the price must
/// be dropped (unconvertible currency, or rates unavailable mid-conversion).
pub async fn normalize_external_price(
    pool: &PgPool,
    http: &reqwest::Client,
    amount: Decimal,
    currency: Option<&str>,
) -> Option<NormalizedPrice> {
    let needs_rates = currency
        .map(str::trim)
        .filter(|c| c.len() == 3 && c.bytes().all(|b| b.is_ascii_alphabetic()))
        .map(str::to_ascii_uppercase)
        .is_some_and(|c| !crate::domain::currency::is_supported(&c));
    if !needs_rates {
        // Synthetic empty table — the pure fn won't look at it on these paths.
        let empty = FxRates {
            base: "EUR".into(),
            date: String::new(),
            rates: BTreeMap::new(),
        };
        return normalize_with_rates(&empty, amount, currency);
    }
    let rates = latest(pool, http, "EUR").await.ok()?;
    normalize_with_rates(&rates, amount, currency)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn d(s: &str) -> Decimal {
        s.parse().unwrap()
    }

    fn table() -> FxRates {
        let mut rates = BTreeMap::new();
        rates.insert("USD".into(), 1.08);
        rates.insert("JPY".into(), 160.0);
        rates.insert("HKD".into(), 8.5);
        FxRates {
            base: "EUR".into(),
            date: "2026-06-12".into(),
            rates,
        }
    }

    #[test]
    fn supported_currency_passes_through() {
        let n = normalize_with_rates(&table(), d("12000"), Some("JPY")).unwrap();
        assert_eq!(n.amount, d("12000"));
        assert_eq!(n.currency, "JPY");
        assert!(n.converted_from.is_none() && !n.assumed_usd);
    }

    #[test]
    fn lowercase_supported_is_normalised() {
        let n = normalize_with_rates(&table(), d("50"), Some(" usd ")).unwrap();
        assert_eq!(n.currency, "USD");
        assert!(!n.assumed_usd);
    }

    #[test]
    fn missing_currency_is_assumed_usd_unchanged() {
        let n = normalize_with_rates(&table(), d("199.5"), None).unwrap();
        assert_eq!((n.amount, n.currency.as_str()), (d("199.5"), "USD"));
        assert!(n.assumed_usd && n.converted_from.is_none());
    }

    #[test]
    fn freeform_label_is_treated_as_missing() {
        let n = normalize_with_rates(&table(), d("80"), Some("US Dollar")).unwrap();
        assert_eq!(n.currency, "USD");
        assert!(n.assumed_usd);
    }

    #[test]
    fn exotic_currency_converts_to_usd() {
        // HK$ 500 → 500 / 8.5 * 1.08 = 63.529… → 63.53 USD
        let n = normalize_with_rates(&table(), d("500"), Some("HKD")).unwrap();
        assert_eq!(n.amount, d("63.53"));
        assert_eq!(n.currency, "USD");
        assert_eq!(n.converted_from, Some((d("500"), "HKD".into())));
        assert!(!n.assumed_usd);
    }

    #[test]
    fn unconvertible_currency_drops_the_price() {
        assert!(normalize_with_rates(&table(), d("4500"), Some("TWD")).is_none());
    }
}

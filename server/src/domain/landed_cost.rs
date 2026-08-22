//! Landed cost — what an imported figure actually costs once it clears customs.
//!
//! A ¥24 800 pre-order is never ¥24 800 for a European buyer: import VAT,
//! duty and the carrier's clearance fee land six weeks later, and every money
//! surface in this app (La Cote, gains, alerts, the insurance dossier) reasons
//! on the pre-import number. This turns the guess into a line-by-line estimate.
//!
//! **Everything is a rule set, nothing is a hardcoded tax.** Rates move — the
//! EU removed its €150 duty de-minimis on 2026-07-01 and replaced it with a
//! transitional flat per-item duty until 2028 — so the numbers live in
//! `app_settings` where an operator can correct them the day they change,
//! without a release. The shipped defaults are a *starting point for a French
//! destination*, explicitly labelled as an estimate.
//!
//! No tax API, no third party: pure arithmetic on a local rule set, so nothing
//! about what you buy leaves the instance.

use crate::error::AppResult;
use rust_decimal::Decimal;
use rust_decimal::prelude::FromPrimitive;
use serde::{Deserialize, Serialize};
use sqlx::PgPool;

/// `app_settings` key holding the JSON rule set.
const SETTINGS_KEY: &str = "import.landed_cost_rules";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DestinationRule {
    /// Import VAT rate, e.g. 0.20 for France.
    pub vat_rate: f64,
    /// Ad-valorem duty rate applied above the low-value threshold. Toys and
    /// statuettes sit low single digits in the EU tariff.
    pub duty_rate: f64,
    /// Consignment value at or below which `low_value_flat_duty` applies
    /// instead of `duty_rate`. `null` disables the low-value branch.
    pub low_value_threshold: Option<f64>,
    /// Flat duty per item for low-value consignments (EU transitional €3,
    /// in force 2026-07-01 → 2028-07-01).
    pub low_value_flat_duty: f64,
    /// Whether VAT is computed on (goods + shipping + duty) rather than on
    /// goods + shipping alone. True in the EU.
    pub vat_on_duty: bool,
    /// Currency the rule's flat amounts are expressed in.
    pub currency: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CarrierRule {
    /// Flat clearance / "presentation to customs" fee.
    pub handling_flat: f64,
    /// Percentage-of-value alternative; the carrier bills the greater of the two.
    #[serde(default)]
    pub handling_pct: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Rules {
    /// Keyed by ISO-3166 alpha-2 destination.
    pub destinations: std::collections::BTreeMap<String, DestinationRule>,
    /// Keyed by a free-form carrier slug the UI offers.
    pub carriers: std::collections::BTreeMap<String, CarrierRule>,
}

impl Default for Rules {
    fn default() -> Self {
        let mut destinations = std::collections::BTreeMap::new();
        destinations.insert(
            "FR".to_string(),
            DestinationRule {
                vat_rate: 0.20,
                duty_rate: 0.047,
                low_value_threshold: Some(150.0),
                low_value_flat_duty: 3.0,
                vat_on_duty: true,
                currency: "EUR".to_string(),
            },
        );
        let mut carriers = std::collections::BTreeMap::new();
        carriers.insert(
            "postal".to_string(),
            CarrierRule { handling_flat: 8.0, handling_pct: 0.0 },
        );
        carriers.insert(
            "express".to_string(),
            CarrierRule { handling_flat: 14.0, handling_pct: 0.02 },
        );
        Rules { destinations, carriers }
    }
}

/// Read the operator's rule set, falling back to the shipped defaults.
/// A malformed stored value degrades to the defaults rather than failing the
/// request — a bad edit must not take the estimator down.
pub async fn rules(pool: &PgPool) -> AppResult<Rules> {
    let raw: Option<String> = sqlx::query_scalar("SELECT value FROM app_settings WHERE key = $1")
        .bind(SETTINGS_KEY)
        .fetch_optional(pool)
        .await?
        .flatten();
    Ok(raw
        .and_then(|v| serde_json::from_str::<Rules>(&v).ok())
        .unwrap_or_default())
}

/// Replace the rule set (admin).
pub async fn set_rules(pool: &PgPool, rules: &Rules) -> AppResult<()> {
    let json = serde_json::to_string(rules)
        .map_err(|e| crate::error::AppError::Internal(anyhow::anyhow!("rules encode: {e}")))?;
    sqlx::query(
        "INSERT INTO app_settings (key, value, updated_at)
         VALUES ($1, $2, now())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()",
    )
    .bind(SETTINGS_KEY)
    .bind(json)
    .execute(pool)
    .await?;
    Ok(())
}

#[derive(Debug, Clone, Deserialize)]
pub struct Quote {
    /// Goods value, in `currency`.
    pub goods: f64,
    #[serde(default)]
    pub shipping: f64,
    /// ISO-4217 of `goods` / `shipping`. Conversion into the destination's
    /// currency is the caller's job — mixing FX into a tax estimate would hide
    /// which number is uncertain.
    pub currency: String,
    /// ISO-3166 alpha-2 destination; unknown → no estimate.
    pub destination: String,
    /// Carrier slug; unknown → no handling fee rather than a guessed one.
    #[serde(default)]
    pub carrier: Option<String>,
    /// Items in the consignment — the EU transitional duty is *per item*.
    #[serde(default = "one")]
    pub items: u32,
}

fn one() -> u32 {
    1
}

#[derive(Debug, Clone, Serialize)]
pub struct Breakdown {
    pub goods: Decimal,
    pub shipping: Decimal,
    pub duty: Decimal,
    pub vat: Decimal,
    pub handling: Decimal,
    pub total: Decimal,
    /// `total - goods - shipping`: what the import itself adds.
    pub import_cost: Decimal,
    pub currency: String,
    /// True when the low-value flat duty applied instead of the ad-valorem rate.
    pub flat_duty_applied: bool,
    /// Always set: these are estimates from an operator-maintained table, not
    /// a customs ruling. The UI must show this.
    pub disclaimer: &'static str,
}

fn dec(v: f64) -> Decimal {
    Decimal::from_f64(v).unwrap_or_default().round_dp(2)
}

/// Compute a landed-cost estimate. Returns `None` when the destination has no
/// rule — an unknown jurisdiction gets silence, not a made-up number.
pub fn estimate(rules: &Rules, q: &Quote) -> Option<Breakdown> {
    let dest = rules.destinations.get(&q.destination.to_uppercase())?;

    let goods = q.goods.max(0.0);
    let shipping = q.shipping.max(0.0);
    // Customs value = goods + transport to the border. Close enough for an
    // estimate, and the same basis the carriers quote from.
    let customs_value = goods + shipping;

    let (duty, flat_duty_applied) = match dest.low_value_threshold {
        Some(threshold) if customs_value <= threshold => {
            (dest.low_value_flat_duty * f64::from(q.items.max(1)), true)
        }
        _ => (customs_value * dest.duty_rate, false),
    };

    let vat_base = if dest.vat_on_duty {
        customs_value + duty
    } else {
        customs_value
    };
    let vat = vat_base * dest.vat_rate;

    let handling = q
        .carrier
        .as_deref()
        .and_then(|c| rules.carriers.get(c))
        .map(|c| c.handling_flat.max(customs_value * c.handling_pct))
        .unwrap_or(0.0);

    let total = goods + shipping + duty + vat + handling;
    Some(Breakdown {
        goods: dec(goods),
        shipping: dec(shipping),
        duty: dec(duty),
        vat: dec(vat),
        handling: dec(handling),
        total: dec(total),
        import_cost: dec(duty + vat + handling),
        currency: q.currency.to_uppercase(),
        flat_duty_applied,
        disclaimer: "estimate from an operator-maintained rule table, not a customs ruling",
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn q(goods: f64, shipping: f64, items: u32, carrier: Option<&str>) -> Quote {
        Quote {
            goods,
            shipping,
            currency: "EUR".into(),
            destination: "FR".into(),
            carrier: carrier.map(str::to_string),
            items,
        }
    }

    #[test]
    fn low_value_uses_the_flat_per_item_duty() {
        // Post-2026-07-01 EU: no more duty-free under 150 €, a flat fee per
        // item instead — and VAT from the first euro.
        let r = Rules::default();
        let b = estimate(&r, &q(100.0, 10.0, 2, None)).unwrap();
        assert!(b.flat_duty_applied);
        assert_eq!(b.duty, dec(6.0)); // 3 € × 2 items
        // VAT on goods + shipping + duty = 116 × 0.20
        assert_eq!(b.vat, dec(23.2));
        assert_eq!(b.total, dec(139.2));
    }

    #[test]
    fn above_threshold_uses_the_ad_valorem_rate() {
        let r = Rules::default();
        let b = estimate(&r, &q(400.0, 20.0, 1, None)).unwrap();
        assert!(!b.flat_duty_applied);
        assert_eq!(b.duty, dec(420.0 * 0.047));
        assert_eq!(b.import_cost, dec(b.duty.to_string().parse::<f64>().unwrap() + (420.0 + 420.0 * 0.047) * 0.20));
    }

    #[test]
    fn carrier_handling_takes_the_greater_of_flat_and_percent() {
        let r = Rules::default();
        // express: max(14, 2% of value). At 2000 € that's 40 €.
        let b = estimate(&r, &q(2000.0, 0.0, 1, Some("express"))).unwrap();
        assert_eq!(b.handling, dec(40.0));
        // At 200 € the flat fee wins.
        let b2 = estimate(&r, &q(200.0, 0.0, 1, Some("express"))).unwrap();
        assert_eq!(b2.handling, dec(14.0));
    }

    #[test]
    fn unknown_destination_returns_nothing_rather_than_a_guess() {
        let r = Rules::default();
        let mut quote = q(100.0, 0.0, 1, None);
        quote.destination = "ZZ".into();
        assert!(estimate(&r, &quote).is_none());
    }

    #[test]
    fn unknown_carrier_adds_no_handling() {
        let r = Rules::default();
        let b = estimate(&r, &q(100.0, 0.0, 1, Some("pigeon"))).unwrap();
        assert_eq!(b.handling, dec(0.0));
    }
}

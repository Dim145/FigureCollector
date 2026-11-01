//! User wishlist (`wishlist_items`) repository.
//!
//! Each row references a catalogue figure (`figure_id` FK); display fields are
//! joined from `figures` / `manufacturers`. `max_price_amount` is the user's
//! target price (the "cible"); `note` a free-text reminder.

use crate::domain::stats::PRICE_FRESH_DAYS;
use crate::error::{AppError, AppResult};
use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, PgPool};
use std::sync::LazyLock;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct WishlistItem {
    pub figure_id: Uuid,
    pub max_price_amount: Option<Decimal>,
    pub max_price_currency: Option<String>,
    pub note: Option<String>,
    pub created_at: DateTime<Utc>,
    // ── joined from the catalogue ──
    pub figure_name: String,
    pub figure_slug: String,
    pub figure_type: String,
    pub figure_image: Option<String>,
    pub manufacturer_name: Option<String>,
    pub scale: Option<String>,
    pub msrp_amount: Option<Decimal>,
    pub msrp_currency: Option<String>,
    /// Latest market price observed by the price cron — the SPA's "deal met"
    /// check prefers it over the MSRP. `None` when never priced, and also once
    /// the sweep hasn't confirmed it in [`PRICE_FRESH_DAYS`]: the listing
    /// stopped resolving, so the last thing that shop asked is history, not a
    /// price anyone can pay. Same rule as the collection's valuation.
    pub provider_price_amount: Option<Decimal>,
    pub provider_price_currency: Option<String>,
    /// When the sweep last confirmed the shop price, moved or not — the end of
    /// what the price history can vouch for. Kept when the price went stale.
    pub provider_price_fetched_at: Option<DateTime<Utc>>,
    /// A shop price exists but is too old to count (see
    /// `provider_price_amount`), so a target is measured against the MSRP.
    pub provider_price_stale: bool,
    pub is_nsfw: bool,
    /// Catalogue primary photo id (cover fallback), so the SPA builds the
    /// `/api/figure-photos/{id}` URL without a second query per row.
    pub catalog_cover_photo_id: Option<Uuid>,
    /// Whether the target is met, and how that was decided — filled in by
    /// [`annotate_targets`], not by SQL. `None` when there is no target, no
    /// price to compare it with, or no rate bridging the two currencies.
    ///
    /// `skip`, not `default`: the row has no such column to decode at all.
    #[sqlx(skip)]
    pub target_comparison: Option<TargetComparison>,
    /// Best availability across every shop linked to this figure, using the
    /// same 7-day freshness window as [`crate::domain::store`] (a row that
    /// stopped refreshing ages back to "unknown" = `None`). "Best" means the
    /// most buyable: in_stock > preorder > out_of_stock — the wishlist asks
    /// "can I get it", not "what does shop X say".
    pub stock_status: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct NewWishlistItem {
    pub figure_id: Uuid,
    #[serde(default)]
    pub max_price_amount: Option<Decimal>,
    #[serde(default)]
    pub max_price_currency: Option<String>,
    #[serde(default)]
    pub note: Option<String>,
}

/// Direct-set patch (no COALESCE): a `null` field clears it, so the editor can
/// drop a target price / note. The SPA sends the full intended state.
#[derive(Debug, Deserialize)]
pub struct WishlistPatch {
    #[serde(default)]
    pub max_price_amount: Option<Decimal>,
    #[serde(default)]
    pub max_price_currency: Option<String>,
    #[serde(default)]
    pub note: Option<String>,
}

static SELECT: LazyLock<String> = LazyLock::new(|| {
    format!(
        "
    SELECT w.figure_id, w.max_price_amount, w.max_price_currency, w.note, w.created_at,
           f.name AS figure_name, f.slug AS figure_slug, f.figure_type,
           f.official_image_url AS figure_image,
           m.name AS manufacturer_name, f.scale,
           f.msrp_amount, f.msrp_currency,
           -- A price the sweep stopped refreshing is not a market price; see
           -- PRICE_FRESH_DAYS.
           CASE WHEN pp.fetched_at > now() - interval '{PRICE_FRESH_DAYS} days'
                THEN pp.amount END   AS provider_price_amount,
           CASE WHEN pp.fetched_at > now() - interval '{PRICE_FRESH_DAYS} days'
                THEN pp.currency END AS provider_price_currency,
           pp.fetched_at             AS provider_price_fetched_at,
           COALESCE(pp.fetched_at <= now() - interval '{PRICE_FRESH_DAYS} days', false)
                                     AS provider_price_stale,
           f.is_nsfw,
           (
               SELECT fp.id FROM figure_photos fp
               WHERE fp.figure_id = f.id
               ORDER BY fp.is_primary DESC, fp.position ASC, fp.created_at ASC
               LIMIT 1
           ) AS catalog_cover_photo_id,
           (
               SELECT fss.status FROM figure_shop_stock fss
               WHERE fss.figure_id = f.id
                 AND fss.checked_at > now() - interval '7 days'
               ORDER BY CASE fss.status
                            WHEN 'in_stock'  THEN 0
                            WHEN 'preorder'  THEN 1
                            ELSE 2
                        END
               LIMIT 1
           ) AS stock_status
    FROM wishlist_items w
    JOIN figures f          ON f.id = w.figure_id
    LEFT JOIN figure_provider_prices pp ON pp.figure_id = f.id
    LEFT JOIN manufacturers m ON m.id = f.manufacturer_id"
    )
});

/// How a price was measured against a wishlist target.
///
/// The comparison is routinely cross-currency — a €200 target against a $239
/// shop price — and until now only the price sweep could make it. A caller
/// reading the wishlist got two amounts in two currencies and no bridge, so
/// every client had to carry its own rate table to answer the list's whole
/// question: *is this a deal?* An agent over MCP has no rate table at all.
#[derive(Debug, Clone, Serialize)]
pub struct TargetComparison {
    pub met: bool,
    /// `"same_currency"`, `"target_adopts_observed"`, or `"converted_via_eur"`.
    pub basis: &'static str,
    /// Which price was measured: `"provider"` (latest observed shop price) or
    /// `"msrp"` (the catalogue list price, when no shop price exists).
    pub priced_from: &'static str,
    /// Both sides in EUR, present only when a conversion actually happened —
    /// a same-currency comparison has nothing to normalise.
    pub amount_eur: Option<Decimal>,
    pub target_eur: Option<Decimal>,
    /// Date of the rate table used, so the verdict can be audited later.
    pub fx_date: Option<String>,
}

/// Compare one price against one target, converting through EUR when the two
/// are in different currencies. `None` means no verdict was reachable — an
/// amount with no currency, or no rate for the pair — and a caller must then
/// say "unknown" rather than assume either way.
pub fn compare_to_target(
    rates: Option<&crate::external::fx::FxRates>,
    priced_from: &'static str,
    amount: Decimal,
    currency: Option<&str>,
    target: Decimal,
    target_currency: Option<&str>,
) -> Option<TargetComparison> {
    let plain = |met: bool, basis: &'static str| {
        Some(TargetComparison {
            met,
            basis,
            priced_from,
            amount_eur: None,
            target_eur: None,
            fx_date: None,
        })
    };
    match (currency, target_currency) {
        // The SPA's fallback: a target with no currency adopts the observed one.
        (_, None) => plain(amount <= target, "target_adopts_observed"),
        (None, Some(_)) => None,
        (Some(a), Some(b)) if a.trim().eq_ignore_ascii_case(b.trim()) => {
            plain(amount <= target, "same_currency")
        }
        (Some(a), Some(b)) => {
            let r = rates?;
            let price_eur = r.convert_to_base(amount, a)?;
            let target_eur = r.convert_to_base(target, b)?;
            Some(TargetComparison {
                // Decide on the full-precision quotients, report rounded ones.
                // Rounding first could flip a verdict at the cent; dividing by
                // a rate leaves ~28 significant digits, which is noise in a
                // field a human reads as money.
                met: price_eur <= target_eur,
                basis: "converted_via_eur",
                priced_from,
                amount_eur: Some(price_eur.round_dp(2)),
                target_eur: Some(target_eur.round_dp(2)),
                fx_date: Some(r.date.clone()),
            })
        }
    }
}

/// Fill in [`WishlistItem::target_comparison`] for every row that has a target
/// and a price to measure it against.
///
/// One rate table for the whole list (cached 12h), not one per row. A rate
/// fetch that fails leaves same-currency rows answered and cross-currency ones
/// `None` — an honest "couldn't tell", never a wrong verdict.
pub async fn annotate_targets(pool: &PgPool, http: &reqwest::Client, items: &mut [WishlistItem]) {
    if items.iter().all(|i| i.max_price_amount.is_none()) {
        return;
    }
    let rates = crate::external::fx::latest(pool, http, "EUR").await.ok();
    for item in items.iter_mut() {
        let Some(target) = item.max_price_amount else {
            continue;
        };
        // The shop price wins over the catalogue MSRP — same precedence the
        // deal badge has always used. A stale one is already `None` here.
        let priced = match (item.provider_price_amount, item.msrp_amount) {
            (Some(a), _) => Some(("provider", a, item.provider_price_currency.as_deref())),
            (None, Some(a)) => Some(("msrp", a, item.msrp_currency.as_deref())),
            (None, None) => None,
        };
        let Some((priced_from, amount, currency)) = priced else {
            continue;
        };
        item.target_comparison = compare_to_target(
            rates.as_ref(),
            priced_from,
            amount,
            currency,
            target,
            item.max_price_currency.as_deref(),
        );
    }
}

fn check_currency(c: &Option<String>) -> AppResult<()> {
    if let Some(c) = c {
        if !crate::domain::currency::is_supported(c) {
            return Err(AppError::BadRequest(
                "max_price_currency must be a supported currency code",
            ));
        }
    }
    Ok(())
}

pub async fn list(pool: &PgPool, user_id: Uuid, exclude_nsfw: bool) -> AppResult<Vec<WishlistItem>> {
    let mut sql = format!("{} WHERE w.user_id = $1", *SELECT);
    if exclude_nsfw {
        sql.push_str(" AND NOT f.is_nsfw");
    }
    sql.push_str(" ORDER BY w.created_at DESC, w.figure_id DESC");
    Ok(sqlx::query_as::<_, WishlistItem>(&sql)
        .bind(user_id)
        .fetch_all(pool)
        .await?)
}

async fn find_one(pool: &PgPool, user_id: Uuid, figure_id: Uuid) -> AppResult<WishlistItem> {
    let sql = format!("{} WHERE w.user_id = $1 AND w.figure_id = $2", *SELECT);
    sqlx::query_as::<_, WishlistItem>(&sql)
        .bind(user_id)
        .bind(figure_id)
        .fetch_optional(pool)
        .await?
        .ok_or(AppError::NotFound)
}

/// Add a figure to the wishlist. Idempotent: re-adding an already-wished figure
/// updates its target price / note rather than erroring.
pub async fn add(pool: &PgPool, user_id: Uuid, input: NewWishlistItem) -> AppResult<WishlistItem> {
    check_currency(&input.max_price_currency)?;

    // "owned ≠ wishlist": a figure already ACTIVELY owned can't be wished for
    // (an archived/cancelled owned item leaves the user free to re-wish it).
    // The not-owned check is pushed INTO the INSERT (`… SELECT … WHERE NOT
    // EXISTS`) so it's evaluated atomically at insert time — a concurrent
    // add-to-collection can't slip between a separate check and the write
    // (a plain transaction wouldn't help: READ COMMITTED re-snapshots per
    // statement). Idempotent: re-adding an already-wished figure updates it.
    let res = sqlx::query(
        "INSERT INTO wishlist_items (user_id, figure_id, max_price_amount, max_price_currency, note)
         SELECT $1, $2, $3, $4, $5
         WHERE NOT EXISTS (
             SELECT 1 FROM owned_items
             WHERE user_id = $1 AND figure_id = $2 AND archived_at IS NULL
         )
         ON CONFLICT (user_id, figure_id) DO UPDATE SET
             max_price_amount   = EXCLUDED.max_price_amount,
             max_price_currency = EXCLUDED.max_price_currency,
             note               = EXCLUDED.note",
    )
    .bind(user_id)
    .bind(input.figure_id)
    .bind(input.max_price_amount)
    .bind(&input.max_price_currency)
    .bind(&input.note)
    .execute(pool)
    .await
    .map_err(|e| match e {
        sqlx::Error::Database(ref db) if db.is_foreign_key_violation() => {
            AppError::BadRequest("figure_id does not exist")
        }
        other => AppError::Db(other),
    })?;

    // 0 rows ⇒ the NOT EXISTS guard fired ⇒ the figure is actively owned.
    if res.rows_affected() == 0 {
        return Err(AppError::Conflict("figure is already in your collection"));
    }

    find_one(pool, user_id, input.figure_id).await
}

pub async fn patch(
    pool: &PgPool,
    user_id: Uuid,
    figure_id: Uuid,
    input: WishlistPatch,
) -> AppResult<WishlistItem> {
    check_currency(&input.max_price_currency)?;
    let res = sqlx::query(
        "UPDATE wishlist_items
         SET max_price_amount = $1, max_price_currency = $2, note = $3
         WHERE user_id = $4 AND figure_id = $5",
    )
    .bind(input.max_price_amount)
    .bind(&input.max_price_currency)
    .bind(&input.note)
    .bind(user_id)
    .bind(figure_id)
    .execute(pool)
    .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    find_one(pool, user_id, figure_id).await
}

pub async fn remove(pool: &PgPool, user_id: Uuid, figure_id: Uuid) -> AppResult<()> {
    let res = sqlx::query("DELETE FROM wishlist_items WHERE user_id = $1 AND figure_id = $2")
        .bind(user_id)
        .bind(figure_id)
        .execute(pool)
        .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(target: Option<(i64, &str)>, provider: Option<(i64, &str)>) -> WishlistItem {
        WishlistItem {
            figure_id: Uuid::nil(),
            max_price_amount: target.map(|(a, _)| Decimal::from(a)),
            max_price_currency: target.map(|(_, c)| c.to_string()),
            note: None,
            created_at: Utc::now(),
            figure_name: "x".into(),
            figure_slug: "x".into(),
            figure_type: "statue".into(),
            figure_image: None,
            manufacturer_name: None,
            scale: None,
            msrp_amount: None,
            msrp_currency: None,
            provider_price_amount: provider.map(|(a, _)| Decimal::from(a)),
            provider_price_currency: provider.map(|(_, c)| c.to_string()),
            provider_price_fetched_at: provider.map(|_| Utc::now()),
            provider_price_stale: false,
            is_nsfw: false,
            catalog_cover_photo_id: None,
            target_comparison: None,
            stock_status: None,
        }
    }

    #[test]
    fn the_comparison_reports_its_basis() {
        let same = compare_to_target(
            None,
            "provider",
            Decimal::from(100),
            Some("EUR"),
            Decimal::from(150),
            Some("EUR"),
        )
        .expect("same currency is always comparable");
        assert!(same.met);
        assert_eq!(same.basis, "same_currency");
        assert_eq!(same.priced_from, "provider");
        assert!(same.amount_eur.is_none(), "no conversion, nothing to audit");

        let adopted = compare_to_target(
            None,
            "provider",
            Decimal::from(100),
            Some("JPY"),
            Decimal::from(150),
            None,
        )
        .expect("a currency-less target adopts the observed one");
        assert_eq!(adopted.basis, "target_adopts_observed");

        // Cross-currency with no rate table: not comparable, so no verdict.
        assert!(
            compare_to_target(
                None,
                "provider",
                Decimal::from(100),
                Some("USD"),
                Decimal::from(150),
                Some("EUR")
            )
            .is_none()
        );
    }

    /// The case the report caught: a €200 target beside a $239 shop price is
    /// the *opposite* verdict from comparing the bare numbers.
    #[test]
    fn a_cross_currency_row_is_not_decided_on_the_bare_numbers() {
        let rates = crate::external::fx::FxRates {
            base: "EUR".into(),
            date: "2026-09-13".into(),
            rates: [("USD".to_string(), 1.1543_f64)].into_iter().collect(),
        };
        let cmp = compare_to_target(
            Some(&rates),
            "provider",
            Decimal::from(239),
            Some("USD"),
            Decimal::from(200),
            Some("EUR"),
        )
        .expect("a rate for the pair exists");
        // 239 > 200 on the bare numbers; 239 USD ≈ 207 EUR, still over.
        assert!(!cmp.met);
        assert_eq!(cmp.basis, "converted_via_eur");
        assert_eq!(cmp.fx_date.as_deref(), Some("2026-09-13"));

        // And the case that looks like a false positive from the outside:
        // 269 USD against a 240 EUR target reads as "over" and is not.
        let under = compare_to_target(
            Some(&rates),
            "provider",
            Decimal::from(269),
            Some("USD"),
            Decimal::from(240),
            Some("EUR"),
        )
        .expect("a rate for the pair exists");
        assert!(under.met, "269 USD is ~233 EUR, under a 240 EUR target");
        assert!(
            under.amount_eur.is_some(),
            "the audited value travels with it"
        );
    }

    /// A money field a person reads must not carry the full quotient of a
    /// division — and the rounding must not be what decides the verdict.
    #[test]
    fn the_reported_euros_are_rounded_but_the_verdict_is_not() {
        let rates = crate::external::fx::FxRates {
            base: "EUR".into(),
            date: "2026-09-11".into(),
            rates: [("USD".to_string(), 1.1592_f64)].into_iter().collect(),
        };
        let cmp = compare_to_target(
            Some(&rates),
            "provider",
            Decimal::from(239),
            Some("USD"),
            Decimal::from(200),
            Some("EUR"),
        )
        .unwrap();
        let eur = cmp.amount_eur.unwrap();
        assert_eq!(eur.scale(), 2, "{eur} should be cents, not a raw quotient");
        assert!(!cmp.met, "206.17 EUR is over a 200 EUR target");

        // A price whose unrounded value is just over the target must stay
        // "not met" even though it rounds down onto it.
        let rates = crate::external::fx::FxRates {
            base: "EUR".into(),
            date: "2026-09-11".into(),
            rates: [("USD".to_string(), 2.0_f64)].into_iter().collect(),
        };
        let edge = compare_to_target(
            Some(&rates),
            "provider",
            Decimal::new(200_009, 2), // 2000.09 USD -> 1000.045 EUR
            Some("USD"),
            Decimal::from(1000),
            Some("EUR"),
        )
        .unwrap();
        // `round_dp` is half-to-even, so the .045 tie reports 1000.04 — and
        // that is exactly why the verdict cannot be taken from it: the
        // displayed euros round *onto* the target while the real value is
        // over it.
        assert_eq!(edge.amount_eur.unwrap(), Decimal::new(100_004, 2));
        assert!(
            !edge.met,
            "1000.045 > 1000 — the rounding must not decide it"
        );
    }

    #[test]
    fn a_row_with_no_shop_price_falls_back_to_the_catalogue_msrp() {
        let mut rows = [item(Some((150, "EUR")), None)];
        rows[0].msrp_amount = Some(Decimal::from(120));
        rows[0].msrp_currency = Some("EUR".into());
        // Same code path annotate_targets takes, without needing a pool.
        let cmp = compare_to_target(
            None,
            "msrp",
            rows[0].msrp_amount.unwrap(),
            rows[0].msrp_currency.as_deref(),
            rows[0].max_price_amount.unwrap(),
            rows[0].max_price_currency.as_deref(),
        )
        .unwrap();
        assert!(cmp.met);
        assert_eq!(cmp.priced_from, "msrp", "the caller must know which price");
    }

    #[test]
    fn a_row_with_no_target_gets_no_verdict() {
        let rows = [item(None, Some((99, "EUR")))];
        assert!(rows[0].target_comparison.is_none());
    }

    /// A shop price the sweep stopped confirming is not one anyone can pay:
    /// the row reads as never priced, so its target is measured against the
    /// MSRP, and it says why — while keeping when the price was last seen.
    #[sqlx::test]
    async fn a_price_the_sweep_lost_is_not_a_market_price(pool: PgPool) {
        let user = seed_user(&pool).await;
        let fresh = seed_wish(&pool, user, Some(2)).await;
        let lost = seed_wish(&pool, user, Some(45)).await;
        let never = seed_wish(&pool, user, None).await;

        let rows = list(&pool, user, false).await.expect("the list must parse");
        let row = |id: Uuid| rows.iter().find(|r| r.figure_id == id).unwrap();

        assert_eq!(row(fresh).provider_price_amount, Some(Decimal::from(100)));
        assert_eq!(row(fresh).provider_price_currency.as_deref(), Some("EUR"));
        assert!(!row(fresh).provider_price_stale);

        assert_eq!(row(lost).provider_price_amount, None);
        assert_eq!(row(lost).provider_price_currency, None);
        assert!(row(lost).provider_price_stale);
        assert!(row(lost).provider_price_fetched_at.is_some());

        assert_eq!(row(never).provider_price_fetched_at, None);
        assert!(
            !row(never).provider_price_stale,
            "never priced is not stale"
        );
    }

    async fn seed_user(pool: &PgPool) -> Uuid {
        let id = Uuid::now_v7();
        sqlx::query("INSERT INTO users (id, username, display_name) VALUES ($1, $2, 'T')")
            .bind(id)
            .bind(id.to_string())
            .execute(pool)
            .await
            .unwrap();
        id
    }

    /// A wished figure, priced `fetched_days_ago` days ago (unpriced on `None`).
    async fn seed_wish(pool: &PgPool, user: Uuid, fetched_days_ago: Option<i32>) -> Uuid {
        let figure = Uuid::now_v7();
        sqlx::query(
            "INSERT INTO figures (id, name, slug, figure_type) VALUES ($1, 'F', $2, 'statue')",
        )
        .bind(figure)
        .bind(figure.to_string())
        .execute(pool)
        .await
        .unwrap();
        sqlx::query("INSERT INTO wishlist_items (user_id, figure_id) VALUES ($1, $2)")
            .bind(user)
            .bind(figure)
            .execute(pool)
            .await
            .unwrap();
        if let Some(days) = fetched_days_ago {
            sqlx::query(
                "INSERT INTO figure_provider_prices (figure_id, amount, currency, source, fetched_at)
                 VALUES ($1, 100, 'EUR', 'proxy', now() - make_interval(days => $2))",
            )
            .bind(figure)
            .bind(days)
            .execute(pool)
            .await
            .unwrap();
        }
        figure
    }
}

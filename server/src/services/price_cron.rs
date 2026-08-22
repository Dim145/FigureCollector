//! Admin-scheduled price-refresh cron — feeds the "cote" market value.
//!
//! For every figure linked to at least one store with an HTTP buy-link, this
//! scrapes the buy-link's product page — orzgk hosts via the native parser
//! (which exposes per-version prices), every other host via the operator proxy
//! (`FIGURE_PROXY_URL`) — and records ONE resolved price per figure in
//! `figure_provider_prices`. That price feeds the cote as a fallback *under*
//! the user's manual valuation and *above* the catalog MSRP (see
//! `domain::stats` / `domain::owned`).
//!
//! Version handling, per the product spec:
//!   - when a figure has a `version_name`, prefer the scraped price whose
//!     version label matches it;
//!   - with no version (or no match), take the highest reported price.
//! "Highest" is compared within a single currency (the figure's MSRP currency
//! when available, else the dominant currency among candidates) so a large
//! JPY figure never spuriously outranks a EUR one.
//!
//! Schedule: the admin-set `cote.price_cron` setting (5-field cron, UTC). Empty
//! disables the job. The loop re-reads the setting every cycle, so enabling /
//! rescheduling / disabling takes effect without a server restart. Upstream
//! reads go through the existing 24h `external_lookups` cache, so prices
//! refresh at most once per cache-TTL however often the cron fires.

use crate::domain::{
    figure_price,
    figure_stock::{self, StockStatus},
    settings,
};
use crate::error::AppResult;
use crate::external::orzgk;
use crate::external::proxy::ProxyClient;
use crate::services::job_runner;
use crate::state::AppState;
use chrono::Utc;
use croner::Cron;
use rust_decimal::Decimal;
use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};
use std::str::FromStr as _;
use std::time::Duration;
use uuid::Uuid;

/// Re-check cadence while disabled (so enabling applies within this long).
const RECHECK_SECS: u64 = 60;
/// Cap on a single sleep so a far-off next run still re-reads the schedule
/// periodically (admin edits / disable apply within at most this long).
const MAX_SLEEP_SECS: u64 = 60 * 30;
/// Boot-settle delay (migrations + listeners) before the first evaluation.
const BOOT_DELAY_SECS: u64 = 90;
/// Politeness gap between upstream product fetches.
const INTER_REQUEST_MS: u64 = 750;
/// Hard cap on figures processed per run — keeps a single sweep bounded on a
/// large catalogue (the remainder are picked up on the next run).
const MAX_FIGURES_PER_RUN: usize = 400;
/// orzgk's host (www-stripped) — these links use the native parser.
const ORZGK_HOST: &str = "orzgk.com";

/// Spawn the price-refresh loop. Returns immediately.
pub fn spawn(state: AppState) {
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_secs(BOOT_DELAY_SECS)).await;
        loop {
            let schedule = match settings::price_cron_schedule(&state.pool).await {
                Ok(s) => s.trim().to_string(),
                Err(e) => {
                    tracing::warn!(error = ?e, "price-cron: cannot read schedule");
                    tokio::time::sleep(Duration::from_secs(RECHECK_SECS)).await;
                    continue;
                }
            };
            if schedule.is_empty() {
                tokio::time::sleep(Duration::from_secs(RECHECK_SECS)).await;
                continue; // feature disabled
            }
            let cron = match Cron::from_str(&schedule) {
                Ok(c) => c,
                Err(e) => {
                    tracing::warn!(error = ?e, schedule = %schedule, "price-cron: invalid schedule (skipping)");
                    tokio::time::sleep(Duration::from_secs(RECHECK_SECS)).await;
                    continue;
                }
            };
            let now = Utc::now();
            let next = match cron.find_next_occurrence(&now, false) {
                Ok(n) => n,
                Err(e) => {
                    tracing::warn!(error = ?e, "price-cron: cannot compute next occurrence");
                    tokio::time::sleep(Duration::from_secs(MAX_SLEEP_SECS)).await;
                    continue;
                }
            };
            let until = (next - now).num_seconds().max(0) as u64;
            if until > MAX_SLEEP_SECS {
                // Far off — sleep the cap, then re-evaluate (re-reads schedule).
                tokio::time::sleep(Duration::from_secs(MAX_SLEEP_SECS)).await;
                continue;
            }
            // Wait until (just past) the scheduled mark, then sweep. The run
            // is recorded in server_job_runs (admin Tasks page).
            tokio::time::sleep(Duration::from_secs(until + 1)).await;
            job_runner::run_recorded(
                &state,
                job_runner::JOB_PRICE_CRON,
                job_runner::TRIGGER_SCHEDULE,
            )
            .await;
            // Step past this minute so we don't immediately re-fire the same hit.
            tokio::time::sleep(Duration::from_secs(RECHECK_SECS)).await;
        }
    });
}

/// One sweep over all store-linked figures. Returns the run summary recorded
/// into `server_job_runs.result`. Public so the job runner (and the admin
/// relaunch route through it) can trigger it directly.
pub async fn run_once(state: &AppState) -> AppResult<serde_json::Value> {
    // Figures with at least one real store buy-link. The full buy URL is
    // origin(`stores.url`) + `figure_stores.link` (path+query); one row per
    // (figure, store-link).
    let rows = sqlx::query_as::<_, (Uuid, Option<String>, Option<String>, String, String, Uuid)>(
        // Order by staleness so the per-run cap rotates through the WHOLE
        // catalogue: never-priced figures (pp.fetched_at NULL) come first, then
        // the oldest refreshes. A static `ORDER BY f.id` re-processed the same
        // first MAX_FIGURES_PER_RUN figures every run, so any figure past the
        // cap (the newest ones) never got a price. f.id is the stable tiebreak.
        "SELECT f.id, f.version_name, f.msrp_currency, s.url, fs.link, fs.store_id
         FROM figures f
         JOIN figure_stores fs ON fs.figure_id = f.id
         JOIN stores s         ON s.id = fs.store_id
         LEFT JOIN figure_provider_prices pp ON pp.figure_id = f.id
         WHERE fs.link IS NOT NULL AND fs.link <> ''
           AND s.url  IS NOT NULL AND s.url  <> ''
         ORDER BY pp.fetched_at ASC NULLS FIRST, f.id",
    )
    .fetch_all(&state.pool)
    .await?;

    // Group buy URLs per figure, preserving version_name + msrp_currency.
    struct FigureJob {
        version_name: Option<String>,
        msrp_currency: Option<String>,
        // Each distinct buy URL → every store_id that resolves to it. Fetching
        // once per URL still records per-shop stock for ALL stores sharing it
        // (two store rows can map to the same product URL).
        urls: Vec<(String, Vec<Uuid>)>,
    }
    let mut jobs: HashMap<Uuid, FigureJob> = HashMap::new();
    let mut order: Vec<Uuid> = Vec::new();
    for (fid, version_name, msrp_currency, store_url, link, store_id) in rows {
        let url = reconstruct_url(&store_url, &link);
        let job = jobs.entry(fid).or_insert_with(|| {
            order.push(fid);
            FigureJob {
                version_name,
                msrp_currency,
                urls: Vec::new(),
            }
        });
        match job.urls.iter_mut().find(|(u, _)| u == &url) {
            Some((_, ids)) => {
                if !ids.contains(&store_id) {
                    ids.push(store_id);
                }
            }
            None => job.urls.push((url, vec![store_id])),
        }
    }

    let proxy = ProxyClient::new(&state.config.proxy, &state.http);
    // Hosts the proxy can handle (www-stripped). Best-effort: if /stores is
    // unavailable we fall back to trying the proxy for any non-orzgk host and
    // let it 501 the unsupported ones.
    let proxy_hosts: Option<HashSet<String>> = if proxy.is_configured() {
        match proxy.stores().await {
            Ok(stores) => Some(
                stores
                    .into_iter()
                    .flat_map(|s| s.hosts)
                    .map(|h| norm_host(&h))
                    .collect(),
            ),
            Err(e) => {
                tracing::debug!(error = ?e, "price-cron: proxy /stores unavailable");
                None
            }
        }
    } else {
        None
    };

    let mut processed = 0usize;
    let mut updated = 0usize;
    let mut skipped_unconvertible = 0usize;
    let mut stock_updated = 0usize;
    for fid in order {
        if processed >= MAX_FIGURES_PER_RUN {
            tracing::info!(
                processed,
                "price-cron: hit per-run figure cap; remaining figures next run"
            );
            break;
        }
        processed += 1;
        let job = &jobs[&fid];

        let mut candidates: Vec<Candidate> = Vec::new();
        for (url, store_ids) in &job.urls {
            match fetch_candidates(state, &proxy, proxy_hosts.as_ref(), url).await {
                Ok((mut c, stock)) => {
                    candidates.append(&mut c);
                    // Record per-shop stock for EVERY store sharing this URL: a
                    // signal upserts; a successful fetch with NO signal clears any
                    // prior row (→ "unknown"). A *failed* fetch touches nothing —
                    // the read-side 7-day window (domain::store) then ages such a
                    // row back to "unknown" so a stale badge can't linger.
                    let source = match url::Url::parse(url)
                        .ok()
                        .and_then(|u| u.host_str().map(norm_host))
                    {
                        Some(h) if h == ORZGK_HOST => "orzgk",
                        _ => "proxy",
                    };
                    for store_id in store_ids {
                        match stock {
                            Some(s) => {
                                match figure_stock::upsert(&state.pool, fid, *store_id, s, source)
                                    .await
                                {
                                    Ok(prev) => {
                                        stock_updated += 1;
                                        // The one stock change worth waking
                                        // someone for: a listing we had SEEN
                                        // sold out is buyable again. A
                                        // first-ever observation (prev None)
                                        // is not a "return", and neither is
                                        // preorder → in_stock.
                                        if prev == Some(StockStatus::OutOfStock)
                                            && matches!(
                                                s,
                                                StockStatus::InStock | StockStatus::Preorder
                                            )
                                        {
                                            notify_back_in_stock(state, fid, *store_id, s).await;
                                        }
                                    }
                                    Err(e) => {
                                        tracing::debug!(figure_id = %fid, error = ?e, "price-cron: stock upsert failed")
                                    }
                                }
                            }
                            None => {
                                let _ = figure_stock::clear(&state.pool, fid, *store_id).await;
                            }
                        }
                    }
                }
                Err(e) => {
                    tracing::debug!(figure_id = %fid, url = %url, error = ?e, "price-cron: fetch failed")
                }
            }
            tokio::time::sleep(Duration::from_millis(INTER_REQUEST_MS)).await;
        }

        if let Some(chosen) = resolve(
            job.version_name.as_deref(),
            job.msrp_currency.as_deref(),
            &candidates,
        ) {
            if let Some(raw_amount) = Decimal::from_f64_retain(chosen.amount).map(|d| d.round_dp(2))
            {
                if raw_amount > Decimal::ZERO {
                    // Normalise into a SUPPORTED currency before recording
                    // (import rule): supported kept as-is; missing/free-form
                    // ("US Dollar") → assumed USD; exotic (HKD, CNY…) →
                    // converted to USD at today's ECB rate; unconvertible
                    // (e.g. TWD, absent from the ECB table) → relevé skipped
                    // rather than stored wrong. Also keeps the CHAR(3) column
                    // safe from free-form labels (22001 used to wedge the
                    // whole tx-less sweep).
                    match crate::external::fx::normalize_external_price(
                        &state.pool,
                        &state.http,
                        raw_amount,
                        chosen.currency.as_deref(),
                    )
                    .await
                    {
                        Some(norm) => {
                            match figure_price::upsert(
                                &state.pool,
                                fid,
                                norm.amount,
                                Some(norm.currency.as_str()),
                                chosen.matched_version.as_deref(),
                                &chosen.source,
                                Some(&chosen.url),
                            )
                            .await
                            {
                                Ok(changed) => {
                                    updated += 1;
                                    // Wishlist target alerts — only on a price MOVE so a
                                    // stable price re-observed daily can't spam (the
                                    // notification dedup on (figure, amount) backstops it).
                                    if changed {
                                        notify_wishlist_targets(
                                            state,
                                            fid,
                                            norm.amount,
                                            Some(norm.currency.as_str()),
                                        )
                                        .await;
                                    }
                                }
                                Err(e) => {
                                    tracing::warn!(figure_id = %fid, error = ?e, "price-cron: upsert failed, skipping this figure");
                                }
                            }
                        }
                        None => {
                            skipped_unconvertible += 1;
                            tracing::debug!(
                                figure_id = %fid, currency = ?chosen.currency,
                                "price-cron: unconvertible currency, relevé skipped"
                            );
                        }
                    }
                }
            }
        }
    }

    tracing::info!(
        processed,
        updated,
        skipped_unconvertible,
        stock_updated,
        "price-cron: provider prices refreshed"
    );
    Ok(serde_json::json!({
        "processed": processed,
        "updated": updated,
        "skipped_unconvertible": skipped_unconvertible,
        "stock_updated": stock_updated,
    }))
}

/// Fire `wishlist_back_in_stock` for every user who wishes this figure, after
/// a shop's signal flipped from a KNOWN out-of-stock to buyable. Best-effort —
/// an error here never aborts the sweep. Dedup key =
/// `{figure_id}:{store_id}:{today}`, so a listing that flaps in and out can
/// wake you at most once a day per shop, while a genuine restock months later
/// still fires.
async fn notify_back_in_stock(
    state: &AppState,
    figure_id: Uuid,
    store_id: Uuid,
    status: StockStatus,
) {
    let rows: Vec<(Uuid, String)> = match sqlx::query_as(
        "SELECT w.user_id, f.name
         FROM wishlist_items w
         JOIN figures f ON f.id = w.figure_id
         WHERE w.figure_id = $1",
    )
    .bind(figure_id)
    .fetch_all(&state.pool)
    .await
    {
        Ok(r) => r,
        Err(e) => {
            tracing::warn!(figure_id = %figure_id, error = ?e, "price-cron: wishlist lookup failed");
            return;
        }
    };
    if rows.is_empty() {
        return;
    }

    let store_name: Option<String> =
        sqlx::query_scalar("SELECT name FROM stores WHERE id = $1")
            .bind(store_id)
            .fetch_optional(&state.pool)
            .await
            .ok()
            .flatten();

    let dedup = format!(
        "{figure_id}:{store_id}:{}",
        chrono::Utc::now().date_naive()
    );
    for (user_id, figure_name) in rows {
        crate::services::notify::dispatch(
            state,
            user_id,
            crate::domain::notification::EVENT_WISHLIST_BACK_IN_STOCK,
            serde_json::json!({
                "figure_id": figure_id,
                "figure_name": figure_name,
                "store_id": store_id,
                "store_name": store_name,
                "status": status.as_db(),
            }),
            Some(&dedup),
        )
        .await;
    }
}

/// Fire `wishlist_price_below_target` for every user whose wishlist target on
/// this figure is met by the freshly observed market price. The comparison is
/// **cross-currency**: same currency compares directly, otherwise both sides
/// convert through the EUR table (today's rate) — so a €50 target catches a
/// $45 price. Best-effort — an error here never aborts the sweep. Dedup key =
/// `{figure_id}:{amount}`, so each price LEVEL notifies once and a further
/// drop re-fires.
async fn notify_wishlist_targets(
    state: &AppState,
    figure_id: Uuid,
    amount: Decimal,
    currency: Option<&str>,
) {
    let rows: Vec<(Uuid, Decimal, Option<String>, String)> = match sqlx::query_as(
        "SELECT w.user_id, w.max_price_amount, w.max_price_currency, f.name
         FROM wishlist_items w
         JOIN figures f ON f.id = w.figure_id
         WHERE w.figure_id = $1 AND w.max_price_amount IS NOT NULL",
    )
    .bind(figure_id)
    .fetch_all(&state.pool)
    .await
    {
        Ok(r) => r,
        Err(e) => {
            tracing::warn!(figure_id = %figure_id, error = ?e, "price-cron: wishlist target lookup failed");
            return;
        }
    };
    if rows.is_empty() {
        return;
    }

    // One EUR table for every cross-currency comparison this figure needs
    // (cached 12h). On a fetch failure we degrade to same-currency-only —
    // never worse than the old behaviour — via `target_met`'s None arm.
    let rates = crate::external::fx::latest(&state.pool, &state.http, "EUR")
        .await
        .ok();

    for (user_id, target, target_currency, figure_name) in rows {
        if !target_met(
            rates.as_ref(),
            amount,
            currency,
            target,
            target_currency.as_deref(),
        ) {
            continue;
        }
        let dedup = format!("{figure_id}:{amount}");
        crate::services::notify::dispatch(
            state,
            user_id,
            crate::domain::notification::EVENT_WISHLIST_PRICE_BELOW_TARGET,
            serde_json::json!({
                "figure_id": figure_id,
                "figure_name": figure_name,
                "amount": amount.to_string(),
                "currency": currency,
                "target_amount": target.to_string(),
                "target_currency": target_currency,
            }),
            Some(&dedup),
        )
        .await;
    }
}

/// Is the observed market price at or below a wishlist target?
///
/// - same currency (case-insensitive) → direct compare;
/// - target with no currency → adopts the observed one (the SPA's fallback);
/// - different currencies → convert both through the EUR `rates` table and
///   compare there;
/// - can't be compared (a currency missing from the table, no rates at all, or
///   an uncurrencied price against an explicit target) → `false`.
fn target_met(
    rates: Option<&crate::external::fx::FxRates>,
    amount: Decimal,
    currency: Option<&str>,
    target: Decimal,
    target_currency: Option<&str>,
) -> bool {
    match (currency, target_currency) {
        (_, None) => amount <= target,
        (None, Some(_)) => false,
        (Some(a), Some(b)) if a.trim().eq_ignore_ascii_case(b.trim()) => amount <= target,
        (Some(a), Some(b)) => match rates {
            Some(r) => match (r.convert_to_base(amount, a), r.convert_to_base(target, b)) {
                (Some(price_eur), Some(target_eur)) => price_eur <= target_eur,
                _ => false,
            },
            None => false,
        },
    }
}

/// One scraped price line. `version_label` is the provider's version name (orzgk
/// variants); `None` for non-versioned sources (proxy / simple products).
struct Candidate {
    amount: f64,
    currency: Option<String>,
    version_label: Option<String>,
    source: String,
    url: String,
}

/// The single price chosen for a figure, ready to persist.
struct Resolved {
    amount: f64,
    currency: Option<String>,
    source: String,
    url: String,
    /// The matched version label, or `None` when picked by "highest price".
    matched_version: Option<String>,
}

/// Fetch every candidate price for one buy-link, routing by host.
async fn fetch_candidates(
    state: &AppState,
    proxy: &ProxyClient<'_>,
    proxy_hosts: Option<&HashSet<String>>,
    url: &str,
) -> AppResult<(Vec<Candidate>, Option<StockStatus>)> {
    let host = match url::Url::parse(url).ok().and_then(|u| u.host_str().map(norm_host)) {
        Some(h) => h,
        None => return Ok((Vec::new(), None)),
    };

    // orzgk → native parser (per-version × per-payment prices).
    if host == ORZGK_HOST {
        let detail = orzgk::detail(&state.pool, &state.http, &state.config.flaresolverr, url).await?;
        let top_ccy = detail.currency.clone();
        let mut out = Vec::new();
        if detail.versions.is_empty() {
            for p in &detail.prices {
                out.push(Candidate {
                    amount: p.amount,
                    currency: p.currency.clone().or_else(|| top_ccy.clone()),
                    version_label: None,
                    source: "orzgk".to_string(),
                    url: url.to_string(),
                });
            }
        } else {
            for v in &detail.versions {
                for p in &v.prices {
                    out.push(Candidate {
                        amount: p.amount,
                        currency: p.currency.clone().or_else(|| top_ccy.clone()),
                        version_label: Some(v.label.clone()),
                        source: "orzgk".to_string(),
                        url: url.to_string(),
                    });
                }
            }
        }
        let stock = detail.stock_status.as_deref().and_then(StockStatus::from_woocommerce);
        return Ok((out, stock));
    }

    // Everything else → the operator proxy, when configured + handling this host.
    if proxy.is_configured() {
        let host_ok = proxy_hosts.is_none_or(|set| set.contains(&host));
        if host_ok {
            let product = proxy.product(url).await?;
            let stock = product.status.as_deref().and_then(StockStatus::from_woocommerce);
            let mut out = Vec::new();
            if let Some(price) = product.price {
                out.push(Candidate {
                    amount: price.amount,
                    currency: price.currency,
                    version_label: None,
                    source: "proxy".to_string(),
                    url: url.to_string(),
                });
            }
            return Ok((out, stock));
        }
    }
    Ok((Vec::new(), None))
}

/// Apply the version-match / highest-price rule to a figure's candidates.
fn resolve(
    version_name: Option<&str>,
    prefer_currency: Option<&str>,
    candidates: &[Candidate],
) -> Option<Resolved> {
    if candidates.is_empty() {
        return None;
    }
    let want = version_name.map(str::trim).filter(|s| !s.is_empty());

    // Candidates whose version label matches the figure's version_name.
    let matched: Vec<&Candidate> = match want {
        Some(w) => candidates
            .iter()
            .filter(|c| {
                c.version_label
                    .as_deref()
                    .is_some_and(|l| version_matches(w, l))
            })
            .collect(),
        None => Vec::new(),
    };
    let (pool, is_match): (Vec<&Candidate>, bool) = if matched.is_empty() {
        (candidates.iter().collect(), false)
    } else {
        (matched, true)
    };

    let chosen = highest(&pool, prefer_currency)?;
    Some(Resolved {
        amount: chosen.amount,
        currency: chosen.currency.clone(),
        source: chosen.source.clone(),
        url: chosen.url.clone(),
        matched_version: if is_match {
            chosen.version_label.clone()
        } else {
            None
        },
    })
}

/// Pick the highest-amount candidate, comparing only within a single currency
/// (the preferred currency when present, else the most frequent among them).
fn highest<'a>(pool: &[&'a Candidate], prefer_currency: Option<&str>) -> Option<&'a Candidate> {
    if pool.is_empty() {
        return None;
    }
    let target: Option<String> = prefer_currency
        .filter(|p| pool.iter().any(|c| eq_ccy(c.currency.as_deref(), Some(*p))))
        .map(|s| s.to_string())
        .or_else(|| modal_currency(pool));

    pool.iter()
        .filter(|c| eq_ccy(c.currency.as_deref(), target.as_deref()))
        .copied()
        .max_by(|a, b| a.amount.partial_cmp(&b.amount).unwrap_or(Ordering::Equal))
}

/// Most frequent non-empty currency among the candidates (uppercased), if any.
fn modal_currency(pool: &[&Candidate]) -> Option<String> {
    let mut counts: HashMap<String, usize> = HashMap::new();
    for c in pool {
        if let Some(cur) = c.currency.as_deref() {
            let key = cur.trim().to_uppercase();
            if !key.is_empty() {
                *counts.entry(key).or_default() += 1;
            }
        }
    }
    counts.into_iter().max_by_key(|(_, n)| *n).map(|(k, _)| k)
}

/// Case-insensitive currency equality; `None == None`.
fn eq_ccy(a: Option<&str>, b: Option<&str>) -> bool {
    match (a, b) {
        (Some(x), Some(y)) => x.trim().eq_ignore_ascii_case(y.trim()),
        (None, None) => true,
        _ => false,
    }
}

/// Fuzzy version match: alphanumeric-normalised equality or containment, so
/// `"Standard Ver."` matches orzgk's `"Standard Version"`.
fn version_matches(want: &str, label: &str) -> bool {
    let w = normalize(want);
    let l = normalize(label);
    !w.is_empty() && !l.is_empty() && (w == l || l.contains(&w) || w.contains(&l))
}

fn normalize(s: &str) -> String {
    s.chars()
        .filter(|c| c.is_alphanumeric())
        .flat_map(|c| c.to_lowercase())
        .collect()
}

/// Lowercase + strip a leading `www.` from a host.
fn norm_host(h: &str) -> String {
    h.trim().to_lowercase().trim_start_matches("www.").to_string()
}

/// Reassemble origin(`stores.url`) + `figure_stores.link` into a full URL.
fn reconstruct_url(store_url: &str, link: &str) -> String {
    let base = store_url.trim_end_matches('/');
    if link.starts_with('/') {
        format!("{base}{link}")
    } else {
        format!("{base}/{link}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cand(amount: f64, ccy: &str, version: Option<&str>) -> Candidate {
        Candidate {
            amount,
            currency: Some(ccy.to_string()),
            version_label: version.map(|s| s.to_string()),
            source: "orzgk".to_string(),
            url: "https://www.orzgk.com/product/x/".to_string(),
        }
    }

    #[test]
    fn version_match_is_fuzzy() {
        assert!(version_matches("Standard Ver.", "Standard Version"));
        assert!(version_matches("deluxe", "Deluxe Edition"));
        assert!(!version_matches("Deluxe", "Standard Version"));
    }

    #[test]
    fn picks_matching_version_full_price() {
        // Standard = deposit(40) + full(120); Deluxe(300) is pricier overall.
        // Asking for "Standard Ver." must yield Standard's FULL price (120) —
        // not the cheaper deposit, and not the pricier non-matching Deluxe.
        let cands = vec![
            cand(40.0, "EUR", Some("Standard Version")),
            cand(120.0, "EUR", Some("Standard Version")),
            cand(300.0, "EUR", Some("Deluxe Version")),
        ];
        let r = resolve(Some("Standard Ver."), Some("EUR"), &cands).unwrap();
        assert_eq!(r.amount, 120.0);
        assert_eq!(r.matched_version.as_deref(), Some("Standard Version"));
    }

    #[test]
    fn picks_highest_when_no_version() {
        let cands = vec![
            cand(120.0, "EUR", Some("Standard Version")),
            cand(300.0, "EUR", Some("Deluxe Version")),
        ];
        let r = resolve(None, Some("EUR"), &cands).unwrap();
        assert_eq!(r.amount, 300.0);
        assert!(r.matched_version.is_none());
    }

    #[test]
    fn falls_back_to_highest_when_version_absent() {
        let cands = vec![cand(120.0, "EUR", Some("Standard Version"))];
        let r = resolve(Some("Swimsuit"), Some("EUR"), &cands).unwrap();
        assert_eq!(r.amount, 120.0);
        assert!(r.matched_version.is_none());
    }

    #[test]
    fn highest_stays_within_preferred_currency() {
        // A large JPY figure must not spuriously outrank the EUR price.
        let cands = vec![cand(150.0, "EUR", None), cand(20000.0, "JPY", None)];
        let r = resolve(None, Some("EUR"), &cands).unwrap();
        assert_eq!(r.amount, 150.0);
        assert_eq!(r.currency.as_deref(), Some("EUR"));
    }

    #[test]
    fn reconstruct_url_joins_origin_and_path() {
        assert_eq!(
            reconstruct_url("https://shop.example", "/product/abc?x=1"),
            "https://shop.example/product/abc?x=1"
        );
        assert_eq!(
            reconstruct_url("https://shop.example/", "product/abc"),
            "https://shop.example/product/abc"
        );
    }

    fn fx() -> crate::external::fx::FxRates {
        let mut rates = std::collections::BTreeMap::new();
        rates.insert("USD".into(), 1.1); // €1 = $1.10
        rates.insert("JPY".into(), 160.0);
        crate::external::fx::FxRates {
            base: "EUR".into(),
            date: "2026-06-12".into(),
            rates,
        }
    }

    fn d(s: &str) -> Decimal {
        s.parse().unwrap()
    }

    #[test]
    fn target_met_same_currency_direct_compare() {
        let r = fx();
        assert!(target_met(Some(&r), d("45"), Some("USD"), d("50"), Some("USD")));
        assert!(!target_met(Some(&r), d("55"), Some("USD"), d("50"), Some("USD")));
    }

    #[test]
    fn target_met_cross_currency_converts_through_eur() {
        let r = fx();
        // $45 = €40.91; a €50 target is met. $60 = €54.55 is not.
        assert!(target_met(Some(&r), d("45"), Some("USD"), d("50"), Some("EUR")));
        assert!(!target_met(Some(&r), d("60"), Some("USD"), d("50"), Some("EUR")));
        // ¥6400 = €40; €50 target met.
        assert!(target_met(Some(&r), d("6400"), Some("JPY"), d("50"), Some("EUR")));
    }

    #[test]
    fn target_met_targetless_adopts_observed() {
        let r = fx();
        assert!(target_met(Some(&r), d("45"), Some("HKD"), d("50"), None));
        assert!(!target_met(Some(&r), d("55"), Some("HKD"), d("50"), None));
    }

    #[test]
    fn target_met_uncomparable_is_false() {
        let r = fx();
        // No rate table at all → cross-currency can't be compared.
        assert!(!target_met(None, d("45"), Some("USD"), d("50"), Some("EUR")));
        // A priced-but-uncurrencied observation vs an explicit target.
        assert!(!target_met(Some(&r), d("45"), None, d("50"), Some("EUR")));
    }
}

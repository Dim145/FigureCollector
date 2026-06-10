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

use crate::domain::{figure_price, settings};
use crate::error::AppResult;
use crate::external::orzgk;
use crate::external::proxy::ProxyClient;
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
            // Wait until (just past) the scheduled mark, then sweep.
            tokio::time::sleep(Duration::from_secs(until + 1)).await;
            if let Err(e) = run_once(&state).await {
                tracing::warn!(error = ?e, "price-cron: sweep failed");
            }
            // Step past this minute so we don't immediately re-fire the same hit.
            tokio::time::sleep(Duration::from_secs(RECHECK_SECS)).await;
        }
    });
}

/// One sweep over all store-linked figures. Public so an admin tool / test can
/// trigger it directly.
pub async fn run_once(state: &AppState) -> AppResult<()> {
    // Figures with at least one real store buy-link. The full buy URL is
    // origin(`stores.url`) + `figure_stores.link` (path+query); one row per
    // (figure, store-link).
    let rows = sqlx::query_as::<_, (Uuid, Option<String>, Option<String>, String, String)>(
        // Order by staleness so the per-run cap rotates through the WHOLE
        // catalogue: never-priced figures (pp.fetched_at NULL) come first, then
        // the oldest refreshes. A static `ORDER BY f.id` re-processed the same
        // first MAX_FIGURES_PER_RUN figures every run, so any figure past the
        // cap (the newest ones) never got a price. f.id is the stable tiebreak.
        "SELECT f.id, f.version_name, f.msrp_currency, s.url, fs.link
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
        urls: Vec<String>,
    }
    let mut jobs: HashMap<Uuid, FigureJob> = HashMap::new();
    let mut order: Vec<Uuid> = Vec::new();
    for (fid, version_name, msrp_currency, store_url, link) in rows {
        let url = reconstruct_url(&store_url, &link);
        let job = jobs.entry(fid).or_insert_with(|| {
            order.push(fid);
            FigureJob {
                version_name,
                msrp_currency,
                urls: Vec::new(),
            }
        });
        if !job.urls.contains(&url) {
            job.urls.push(url);
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
        for url in &job.urls {
            match fetch_candidates(state, &proxy, proxy_hosts.as_ref(), url).await {
                Ok(mut c) => candidates.append(&mut c),
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
            if let Some(amount) = Decimal::from_f64_retain(chosen.amount).map(|d| d.round_dp(2)) {
                if amount > Decimal::ZERO {
                    // Normalise the scraped currency to a 3-letter ISO code or
                    // NULL. The column is CHAR(3); a free-form value like "US
                    // Dollar" raises 22001 — and because the sweep is a single
                    // tx-less loop, the old `?` aborted EVERY later figure on
                    // every run (a permanent wedge). Both the normalisation and
                    // the per-figure error handling below prevent that.
                    let currency = normalize_currency(chosen.currency.as_deref());
                    match figure_price::upsert(
                        &state.pool,
                        fid,
                        amount,
                        currency.as_deref(),
                        chosen.matched_version.as_deref(),
                        &chosen.source,
                        Some(&chosen.url),
                    )
                    .await
                    {
                        Ok(()) => updated += 1,
                        Err(e) => {
                            tracing::warn!(figure_id = %fid, error = ?e, "price-cron: upsert failed, skipping this figure");
                        }
                    }
                }
            }
        }
    }

    tracing::info!(processed, updated, "price-cron: provider prices refreshed");
    Ok(())
}

/// Fit a scraped currency to the CHAR(3) `figure_provider_prices.currency`
/// column: a trimmed, uppercased 3-letter ASCII ISO code, or None for anything
/// else (free-form labels like "US Dollar" would overflow the column).
fn normalize_currency(raw: Option<&str>) -> Option<String> {
    let c = raw?.trim();
    if c.len() == 3 && c.bytes().all(|b| b.is_ascii_alphabetic()) {
        Some(c.to_ascii_uppercase())
    } else {
        None
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
) -> AppResult<Vec<Candidate>> {
    let host = match url::Url::parse(url).ok().and_then(|u| u.host_str().map(norm_host)) {
        Some(h) => h,
        None => return Ok(Vec::new()),
    };

    // orzgk → native parser (per-version × per-payment prices).
    if host == ORZGK_HOST {
        let detail = orzgk::detail(&state.pool, &state.http, url).await?;
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
        return Ok(out);
    }

    // Everything else → the operator proxy, when configured + handling this host.
    if proxy.is_configured() {
        let host_ok = proxy_hosts.is_none_or(|set| set.contains(&host));
        if host_ok {
            let product = proxy.product(url).await?;
            if let Some(price) = product.price {
                return Ok(vec![Candidate {
                    amount: price.amount,
                    currency: price.currency,
                    version_label: None,
                    source: "proxy".to_string(),
                    url: url.to_string(),
                }]);
            }
        }
    }
    Ok(Vec::new())
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
        assert!(version_matches("pregnancy", "Pregnancy Version"));
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
}

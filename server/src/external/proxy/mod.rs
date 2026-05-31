//! External boutique-scraping proxy.
//!
//! This module is the **client** side of an over-the-network contract:
//! a separate service (self-hosted by the operator, or community-run)
//! does the actual scraping / API calls / Cloudflare-busting against the
//! shops it knows about, and we just forward three routes to it.
//!
//! Operator wires the proxy through two env vars:
//!
//!   - `FIGURE_PROXY_URL` — base URL, no trailing slash. When unset, the
//!     three proxy routes (`/api/external/proxy/{stores,search,product}`)
//!     return `feature_disabled` and the SPA hides their UI.
//!   - `FIGURE_PROXY_API_KEY` — optional bearer token sent on every call.
//!
//! Full response contract lives in `docs/content/features/url-import.md`
//! — the proxy must implement three endpoints:
//!
//!   - `GET <base>/stores`               → list supported boutiques
//!   - `GET <base>/search?q=…&store=…`   → search (store filter optional)
//!   - `GET <base>/product?url=…`        → fetch one product detail
//!
//! Why a proxy at all: scraping is brittle and site-specific. Pushing it
//! out lets the user pick their own scraper (or use ours), bring keys
//! for eBay / Amazon affiliate APIs, etc. — none of that drift lands in
//! this codebase.

use crate::config::ProxyConfig;
use crate::error::{AppError, AppResult};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::time::Duration;

/// Wall-clock cap on any single proxy call. Generous because the proxy
/// may have to wait on slow upstream sites (Cloudflare warm-ups).
const REQUEST_TIMEOUT_SECS: u64 = 30;

// =============================================================================
// Response types
//
// All three endpoints return JSON payloads. `serde` flat structs mirror
// the documented contract — extra fields the proxy emits are ignored, and
// the only required fields are the ones marked non-Option below.
// =============================================================================

/// One boutique the proxy knows how to handle. Returned by `/stores`.
///
/// `hosts` is the routing key the SPA uses to decide which import flow
/// to engage for a pasted URL: a host match in this list means "the
/// proxy can handle this URL". `name` and `url` are presentation —
/// nothing in the import flow consumes them, but the SPA surfaces them
/// in the "supported boutiques" hint.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProxyStore {
    pub id: String,
    pub name: String,
    pub url: Option<String>,
    pub hosts: Vec<String>,
}

/// One search-result row. Lighter than [`ProxyProduct`] on purpose: the
/// `/search` endpoint is meant to fan out across stores and the proxy
/// shouldn't pay the per-product detail-fetch cost for results the user
/// hasn't picked yet.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProxySearchResult {
    pub title: String,
    pub store_id: String,
    pub store_name: Option<String>,
    pub url: String,
    pub image_url: Option<String>,
    pub price: Option<ProxyPrice>,
    /// `"in_stock"`, `"preorder"`, `"sold_out"`, etc. Free-form per
    /// proxy — the SPA shows it verbatim as a chip.
    pub status: Option<String>,
}

/// Full product detail. Same shape as `external::scrape::ScrapedProduct`
/// to keep the figure-form import path symmetric across orzgk (internal)
/// and the proxy. Fields are `Option<…>` when the upstream site doesn't
/// expose them.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProxyProduct {
    pub store_id: String,
    pub url: String,
    pub title: String,
    pub manufacturer: Option<String>,
    pub character: Option<String>,
    pub series: Option<String>,
    pub scale: Option<String>,
    pub height_mm: Option<i32>,
    pub materials: Option<String>,
    pub price: Option<ProxyPrice>,
    pub release_date: Option<String>,
    #[serde(default)]
    pub is_nsfw: bool,
    pub primary_image_url: Option<String>,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProxyPrice {
    pub amount: f64,
    /// ISO 4217 code (USD, EUR, JPY, …) or whatever string the upstream
    /// site uses. The SPA accepts any string and falls back to the
    /// user's default currency when the proxy can't extract one.
    pub currency: Option<String>,
}

// =============================================================================
// Client
// =============================================================================

/// Stateless façade. Cheap to construct on every call — we just hand it
/// the shared reqwest client (already TLS-tuned + UA-set).
pub struct ProxyClient<'a> {
    cfg: &'a ProxyConfig,
    http: &'a Client,
}

impl<'a> ProxyClient<'a> {
    pub fn new(cfg: &'a ProxyConfig, http: &'a Client) -> Self {
        Self { cfg, http }
    }

    /// `true` when an operator has set `FIGURE_PROXY_URL`. Routes call
    /// this to decide between forwarding and returning `feature_disabled`.
    pub fn is_configured(&self) -> bool {
        self.cfg.base_url.is_some()
    }

    pub async fn stores(&self) -> AppResult<Vec<ProxyStore>> {
        self.get_json::<Vec<ProxyStore>>("/stores", &[]).await
    }

    pub async fn search(
        &self,
        query: &str,
        store: Option<&str>,
    ) -> AppResult<Vec<ProxySearchResult>> {
        let mut params: Vec<(&str, &str)> = vec![("q", query)];
        if let Some(s) = store {
            params.push(("store", s));
        }
        self.get_json::<Vec<ProxySearchResult>>("/search", &params)
            .await
    }

    pub async fn product(&self, url: &str) -> AppResult<ProxyProduct> {
        // Defense-in-depth: the `url` here is user-supplied (a pasted product
        // link) and is forwarded verbatim to the operator proxy. Reject
        // anything that isn't a well-formed http(s) URL with a host so we
        // can't be coerced into handing the proxy a `file://`, schemeless, or
        // host-less target.
        let parsed = url::Url::parse(url)
            .map_err(|_| AppError::BadRequest("product url is not a valid URL"))?;
        if !matches!(parsed.scheme(), "http" | "https") {
            return Err(AppError::BadRequest(
                "product url must use the http or https scheme",
            ));
        }
        if parsed.host_str().is_none_or(str::is_empty) {
            return Err(AppError::BadRequest("product url has no host"));
        }

        self.get_json::<ProxyProduct>("/product", &[("url", url)])
            .await
    }

    async fn get_json<T: for<'de> Deserialize<'de>>(
        &self,
        path: &str,
        query: &[(&str, &str)],
    ) -> AppResult<T> {
        let base = self.cfg.base_url.as_deref().ok_or_else(|| {
            AppError::FeatureDisabled(
                "figure scraping proxy is not configured \
                 (set FIGURE_PROXY_URL)",
            )
        })?;
        let endpoint = format!("{base}{path}");
        let mut req = self
            .http
            .get(&endpoint)
            .query(query)
            .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS))
            .header(reqwest::header::ACCEPT, "application/json")
            .header(
                reqwest::header::USER_AGENT,
                "FigureCollector/0.12 (+https://github.com/Dim145/FigureCollector)",
            );
        if let Some(key) = self.cfg.api_key.as_deref() {
            req = req.bearer_auth(key);
        }

        let resp = req
            .send()
            .await
            .map_err(|e| AppError::Internal(anyhow::anyhow!("proxy request failed: {e}")))?;

        let status = resp.status();
        if status.is_success() {
            return resp
                .json::<T>()
                .await
                .map_err(|e| AppError::Internal(anyhow::anyhow!("proxy bad response: {e}")));
        }

        // Translate proxy error statuses into our app-level errors so the
        // SPA can branch on them without inspecting raw HTTP codes.
        match status.as_u16() {
            400 => Err(AppError::BadRequest(
                // Static slice expected by AppError::BadRequest — proxy
                // detail body is logged but not surfaced to the user.
                "proxy rejected the request (invalid URL or query)",
            )),
            401 | 403 => Err(AppError::FeatureDisabled(
                "proxy refused authentication — \
                 check FIGURE_PROXY_API_KEY",
            )),
            404 => Err(AppError::NotFound),
            501 => Err(AppError::BadRequest(
                "proxy does not support the requested store",
            )),
            503 => Err(AppError::FeatureDisabled(
                "proxy upstream is temporarily unavailable \
                 (rate limit or remote site down)",
            )),
            _ => {
                let body = resp.text().await.unwrap_or_default();
                Err(AppError::Internal(anyhow::anyhow!(
                    "proxy returned HTTP {status}: {body}"
                )))
            }
        }
    }
}

//! `/api/external/*` — proxied + cached lookups against third-party metadata
//! providers (AniList, MFC). Authenticated to keep the cache from being
//! abused by anonymous traffic.

use crate::auth;
use crate::error::{AppError, AppResult};
use crate::external::{anilist, circuit_breaker, fx, mal, mfc, orzgk, proxy, tracking};
use crate::state::AppState;
use axum::{
    Json, Router,
    extract::{Path, Query, State},
    routing::{get, post},
};
use rust_decimal::Decimal;
use rust_decimal::prelude::ToPrimitive;
use serde::Deserialize;
use tower_sessions::Session;

// Circuit-breaker 503 messages (static, so they reach the SPA verbatim). After
// repeated failures `circuit_breaker::guard` pauses the source and answers with
// these instead of hammering an upstream that's likely rate-limiting us.
const ORZGK_PAUSED: &str =
    "orzgk est en pause suite à des erreurs répétées (probable rate-limit), réessaie dans quelques minutes";
const PROXY_PAUSED: &str =
    "le proxy de boutiques est en pause suite à des erreurs répétées, réessaie dans quelques minutes";

// ─── Scraped-price normalisation (import rule) ──────────────────────────────
//
// Every price a lookup endpoint hands the SPA is normalised into a SUPPORTED
// currency first (see fx::normalize_external_price): supported kept as-is,
// missing/free-form → assumed USD, exotic (HKD, CNY…) → converted to USD at
// today's ECB rate, unconvertible (TWD…) → the price is dropped rather than
// imported wrong. The SPA therefore never sees a currency its pickers (and the
// server's own whitelist) would reject.

/// Normalise one scraped (amount, currency). Returns the supported-currency
/// `(amount, code, original)` — `original = Some((amount, code))` when an
/// actual conversion happened — or `None` when the price must be dropped.
async fn normalize_scraped_price(
    state: &AppState,
    amount: f64,
    currency: Option<&str>,
) -> Option<(f64, String, Option<(f64, String)>)> {
    let dec = Decimal::from_f64_retain(amount)?;
    let norm = fx::normalize_external_price(&state.pool, &state.http, dec, currency).await?;
    let out = norm.amount.to_f64()?;
    let original = norm
        .converted_from
        .and_then(|(a, c)| Some((a.to_f64()?, c)));
    Some((out, norm.currency, original))
}

/// In-place normalisation of an orzgk price list. Converted entries keep their
/// shop price in the display string ("≈ $63.53 · HK$500.00") so the picker
/// stays honest about the source; unconvertible entries are dropped.
async fn normalize_orzgk_prices(state: &AppState, prices: &mut Vec<orzgk::OrzgkPrice>) {
    let mut kept = Vec::with_capacity(prices.len());
    for mut p in prices.drain(..) {
        match normalize_scraped_price(state, p.amount, p.currency.as_deref()).await {
            Some((amount, currency, original)) => {
                if original.is_some() {
                    let shop = if p.display.is_empty() {
                        format!("{} {}", p.amount, p.currency.as_deref().unwrap_or(""))
                    } else {
                        p.display.clone()
                    };
                    p.display = format!("≈ ${amount:.2} · {shop}");
                }
                p.amount = amount;
                p.currency = Some(currency);
                kept.push(p);
            }
            None => {
                tracing::debug!(currency = ?p.currency, "orzgk price dropped: unconvertible currency");
            }
        }
    }
    *prices = kept;
}

/// Same rule for a proxy version-price list (the struct carries a display too).
async fn normalize_proxy_version_prices(
    state: &AppState,
    prices: &mut Vec<proxy::ProxyVersionPrice>,
) {
    let mut kept = Vec::with_capacity(prices.len());
    for mut p in prices.drain(..) {
        match normalize_scraped_price(state, p.amount, p.currency.as_deref()).await {
            Some((amount, currency, original)) => {
                if original.is_some() {
                    let shop = if p.display.is_empty() {
                        format!("{} {}", p.amount, p.currency.as_deref().unwrap_or(""))
                    } else {
                        p.display.clone()
                    };
                    p.display = format!("≈ ${amount:.2} · {shop}");
                }
                p.amount = amount;
                p.currency = Some(currency);
                kept.push(p);
            }
            None => {
                tracing::debug!(currency = ?p.currency, "proxy price dropped: unconvertible currency");
            }
        }
    }
    *prices = kept;
}

/// Same rule for a bare `ProxyPrice` (no display string).
async fn normalize_proxy_price(state: &AppState, price: &mut Option<proxy::ProxyPrice>) {
    if let Some(p) = price.take() {
        *price = normalize_scraped_price(state, p.amount, p.currency.as_deref())
            .await
            .map(|(amount, currency, _)| proxy::ProxyPrice {
                amount,
                currency: Some(currency),
            });
    }
}

#[derive(Deserialize)]
struct SearchQuery {
    q: Option<String>,
}

#[derive(Deserialize)]
struct UrlQuery {
    url: Option<String>,
}

async fn anilist_search(
    State(state): State<AppState>,
    session: Session,
    Query(q): Query<SearchQuery>,
) -> AppResult<Json<Vec<anilist::AniListMedia>>> {
    auth::require_user(&session).await?;
    let query = q.q.unwrap_or_default();
    if query.trim().len() < 2 {
        return Err(AppError::BadRequest("query must be at least 2 chars"));
    }
    Ok(Json(
        anilist::search_media(&state.pool, &state.http, &query).await?,
    ))
}

async fn anilist_get(
    State(state): State<AppState>,
    session: Session,
    Path(id): Path<i64>,
) -> AppResult<Json<anilist::MediaDetail>> {
    auth::require_user(&session).await?;
    Ok(Json(
        anilist::get_media_with_characters(&state.pool, &state.http, id).await?,
    ))
}

async fn anilist_character_get(
    State(state): State<AppState>,
    session: Session,
    Path(id): Path<i64>,
) -> AppResult<Json<anilist::AniListCharacter>> {
    auth::require_user(&session).await?;
    Ok(Json(
        anilist::get_character(&state.pool, &state.http, id).await?,
    ))
}

#[derive(Deserialize)]
struct CharacterSearchQuery {
    q: Option<String>,
    /// AniList media id — when present, scopes the search to that series'
    /// character roster (the figure form passes the picked series' anilist_id).
    media_id: Option<i64>,
}

async fn anilist_character_search(
    State(state): State<AppState>,
    session: Session,
    Query(q): Query<CharacterSearchQuery>,
) -> AppResult<Json<Vec<anilist::AniListCharacterResult>>> {
    auth::require_user(&session).await?;
    let query = q.q.unwrap_or_default();
    // Scoped search may have an empty query (returns the roster); free search
    // needs the usual ≥2 chars to avoid hammering AniList on a single letter.
    if q.media_id.is_none() && query.trim().len() < 2 {
        return Err(AppError::BadRequest("query must be at least 2 chars"));
    }
    Ok(Json(
        anilist::search_characters(&state.pool, &state.http, &query, q.media_id).await?,
    ))
}

async fn mfc_get(
    State(state): State<AppState>,
    session: Session,
    Path(id): Path<i64>,
) -> AppResult<Json<mfc::MfcItem>> {
    auth::require_user(&session).await?;
    Ok(Json(mfc::get_item(&state.pool, &state.http, id).await?))
}

/// Search MFC by name. Falls through to the same Cloudflare wall as
/// `mfc::get_item` today — we expose the route shape so the SPA can degrade
/// gracefully when the moment a fetch path opens up.
async fn mfc_search(
    State(_state): State<AppState>,
    session: Session,
    Query(q): Query<SearchQuery>,
) -> AppResult<Json<Vec<mfc::MfcItem>>> {
    auth::require_user(&session).await?;
    let _ = q.q;
    Err(AppError::FeatureDisabled(
        "MFC search needs a working fetcher (Cloudflare blocks direct HTTP). \
         Wire one in `external::mfc::fetch_item_html` and update this route.",
    ))
}

#[derive(Deserialize)]
struct MfcParseBody {
    html: String,
}

/// Import-by-paste: parse MFC item HTML the user pasted (sidesteps the
/// Cloudflare wall — no fetch). Returns the normalised item to prefill the
/// figure form.
async fn mfc_parse(
    State(_state): State<AppState>,
    session: Session,
    Json(body): Json<MfcParseBody>,
) -> AppResult<Json<mfc::MfcItem>> {
    auth::require_user(&session).await?;
    if body.html.trim().is_empty() {
        return Err(AppError::BadRequest("paste the MFC page HTML"));
    }
    if body.html.len() > 4_000_000 {
        return Err(AppError::BadRequest("pasted HTML too large (max 4 MB)"));
    }
    Ok(Json(mfc::parse_pasted(&body.html)?))
}

async fn orzgk_search(
    State(state): State<AppState>,
    session: Session,
    Query(q): Query<SearchQuery>,
) -> AppResult<Json<Vec<orzgk::OrzgkItem>>> {
    auth::require_user(&session).await?;
    let query = q.q.unwrap_or_default();
    if query.trim().len() < 2 {
        return Err(AppError::BadRequest("query must be at least 2 chars"));
    }
    Ok(Json(
        circuit_breaker::guard("orzgk", AppError::ServiceUnavailable(ORZGK_PAUSED), || {
            orzgk::search(&state.pool, &state.http, &query)
        })
        .await?,
    ))
}

/// Fetch a public orzgk wishlist (wlfmc) by its share URL, following
/// pagination. Used by the bulk wishlist importer's "récupérer" step.
async fn orzgk_wishlist(
    State(state): State<AppState>,
    session: Session,
    Query(q): Query<UrlQuery>,
) -> AppResult<Json<Vec<orzgk::OrzgkWishItem>>> {
    auth::require_user(&session).await?;
    let url = q
        .url
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or(AppError::BadRequest("missing url parameter"))?;
    Ok(Json(
        circuit_breaker::guard("orzgk", AppError::ServiceUnavailable(ORZGK_PAUSED), || {
            orzgk::fetch_wishlist(&state.pool, &state.http, url)
        })
        .await?,
    ))
}

#[derive(Deserialize)]
struct WishlistParseBody {
    html: String,
}

/// Fallback for a wishlist the user keeps private: paste the page HTML and
/// parse it with the exact same parser as the fetch path (no network).
async fn orzgk_wishlist_parse(
    State(_state): State<AppState>,
    session: Session,
    Json(body): Json<WishlistParseBody>,
) -> AppResult<Json<Vec<orzgk::OrzgkWishItem>>> {
    auth::require_user(&session).await?;
    if body.html.trim().is_empty() {
        return Err(AppError::BadRequest("paste the wishlist page HTML"));
    }
    if body.html.len() > 4_000_000 {
        return Err(AppError::BadRequest("pasted HTML too large (max 4 MB)"));
    }
    Ok(Json(orzgk::parse_wishlist_html(&body.html)))
}

#[derive(Deserialize)]
struct FxQuery {
    base: Option<String>,
}

/// Daily FX rates for the optional display-currency overlay (ECB via
/// frankfurter, cached). `base` is the user's chosen display currency.
async fn fx_latest(
    State(state): State<AppState>,
    session: Session,
    Query(q): Query<FxQuery>,
) -> AppResult<Json<crate::external::fx::FxRates>> {
    auth::require_user(&session).await?;
    let base = q
        .base
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("EUR");
    Ok(Json(
        crate::external::fx::latest(&state.pool, &state.http, base).await?,
    ))
}

// =============================================================================
// Boutique scraping proxy — `/api/external/proxy/{stores,search,product}`
//
// Thin forwarders to the optional external proxy. When
// `FIGURE_PROXY_URL` is unset every route returns `feature_disabled` so
// the SPA hides the matching UI. See `external::proxy` for the wire
// contract and `docs/content/features/url-import.md` for the response
// shapes the proxy must implement.
// =============================================================================

#[derive(Deserialize)]
struct ProxySearchQuery {
    q: Option<String>,
    /// Optional boutique filter (matches `ProxyStore.id`).
    store: Option<String>,
}

fn proxy_client(state: &AppState) -> proxy::ProxyClient<'_> {
    proxy::ProxyClient::new(&state.config.proxy, &state.http)
}

async fn proxy_stores(
    State(state): State<AppState>,
    session: Session,
) -> AppResult<Json<Vec<proxy::ProxyStore>>> {
    auth::require_user(&session).await?;
    let client = proxy_client(&state);
    if !client.is_configured() {
        return Err(AppError::FeatureDisabled(
            "figure scraping proxy is not configured \
             (set FIGURE_PROXY_URL)",
        ));
    }
    Ok(Json(
        circuit_breaker::guard("proxy", AppError::ServiceUnavailable(PROXY_PAUSED), || {
            client.stores()
        })
        .await?,
    ))
}

async fn proxy_search(
    State(state): State<AppState>,
    session: Session,
    Query(q): Query<ProxySearchQuery>,
) -> AppResult<Json<Vec<proxy::ProxySearchResult>>> {
    auth::require_user(&session).await?;
    let client = proxy_client(&state);
    if !client.is_configured() {
        return Err(AppError::FeatureDisabled(
            "figure scraping proxy is not configured",
        ));
    }
    let query = q.q.unwrap_or_default();
    if query.trim().len() < 2 {
        return Err(AppError::BadRequest("query must be at least 2 chars"));
    }
    let store_filter = q.store.as_deref().map(str::trim).filter(|s| !s.is_empty());
    Ok(Json(
        circuit_breaker::guard("proxy", AppError::ServiceUnavailable(PROXY_PAUSED), || {
            client.search(query.trim(), store_filter)
        })
        .await?,
    ))
}

async fn proxy_product(
    State(state): State<AppState>,
    session: Session,
    Query(q): Query<UrlQuery>,
) -> AppResult<Json<proxy::ProxyProduct>> {
    auth::require_user(&session).await?;
    let client = proxy_client(&state);
    if !client.is_configured() {
        return Err(AppError::FeatureDisabled(
            "figure scraping proxy is not configured",
        ));
    }
    let url = q
        .url
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or(AppError::BadRequest("missing url parameter"))?;
    let mut product = circuit_breaker::guard(
        "proxy",
        AppError::ServiceUnavailable(PROXY_PAUSED),
        || client.product(url),
    )
    .await?;
    normalize_proxy_price(&state, &mut product.price).await;
    for v in &mut product.versions {
        normalize_proxy_version_prices(&state, &mut v.prices).await;
    }
    Ok(Json(product))
}

/// Scrape a public wishlist page through the operator proxy (optional 4th
/// contract endpoint). Proxies that don't implement it answer 404/501, which
/// the error mapping surfaces as "store/list not supported".
async fn proxy_wishlist(
    State(state): State<AppState>,
    session: Session,
    Query(q): Query<UrlQuery>,
) -> AppResult<Json<Vec<proxy::ProxyWishItem>>> {
    auth::require_user(&session).await?;
    let client = proxy_client(&state);
    if !client.is_configured() {
        return Err(AppError::FeatureDisabled(
            "figure scraping proxy is not configured",
        ));
    }
    let url = q
        .url
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or(AppError::BadRequest("missing url parameter"))?;
    let mut items = circuit_breaker::guard(
        "proxy",
        AppError::ServiceUnavailable(PROXY_PAUSED),
        || client.wishlist(url),
    )
    .await?;
    for it in &mut items {
        normalize_proxy_price(&state, &mut it.price).await;
    }
    Ok(Json(items))
}

/// Fetch + cache a single orzgk product page. Used by the lookup modal once
/// the user has either picked a result card or pasted a `/product/<slug>/`
/// URL directly. The handler rejects URLs that aren't on `www.orzgk.com` so
/// we don't turn into a generic HTTP proxy.
async fn orzgk_detail(
    State(state): State<AppState>,
    session: Session,
    Query(q): Query<UrlQuery>,
) -> AppResult<Json<orzgk::OrzgkDetail>> {
    auth::require_user(&session).await?;
    let url = q
        .url
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or(AppError::BadRequest("missing url parameter"))?;
    let mut detail = circuit_breaker::guard(
        "orzgk",
        AppError::ServiceUnavailable(ORZGK_PAUSED),
        || orzgk::detail(&state.pool, &state.http, url),
    )
    .await?;
    normalize_orzgk_prices(&state, &mut detail.prices).await;
    for v in &mut detail.versions {
        normalize_orzgk_prices(&state, &mut v.prices).await;
    }
    // The page-level currency mirrors the (now-normalised) price lists.
    detail.currency = detail
        .prices
        .iter()
        .chain(detail.versions.iter().flat_map(|v| v.prices.iter()))
        .find_map(|p| p.currency.clone());
    Ok(Json(detail))
}

// ─── MAL via Jikan ──────────────────────────────────────────────────────────

async fn mal_anime_search(
    State(state): State<AppState>,
    session: Session,
    Query(q): Query<SearchQuery>,
) -> AppResult<Json<Vec<mal::MalAnime>>> {
    auth::require_user(&session).await?;
    let query = q.q.unwrap_or_default();
    if query.trim().len() < 2 {
        return Err(AppError::BadRequest("query must be at least 2 chars"));
    }
    Ok(Json(
        mal::search_anime(&state.pool, &state.http, &query).await?,
    ))
}

async fn mal_anime_get(
    State(state): State<AppState>,
    session: Session,
    Path(id): Path<i64>,
) -> AppResult<Json<mal::MalAnime>> {
    auth::require_user(&session).await?;
    Ok(Json(mal::get_anime(&state.pool, &state.http, id).await?))
}

async fn mal_character_search(
    State(state): State<AppState>,
    session: Session,
    Query(q): Query<SearchQuery>,
) -> AppResult<Json<Vec<mal::MalCharacter>>> {
    auth::require_user(&session).await?;
    let query = q.q.unwrap_or_default();
    if query.trim().len() < 2 {
        return Err(AppError::BadRequest("query must be at least 2 chars"));
    }
    Ok(Json(
        mal::search_character(&state.pool, &state.http, &query).await?,
    ))
}

async fn mal_character_get(
    State(state): State<AppState>,
    session: Session,
    Path(id): Path<i64>,
) -> AppResult<Json<mal::MalCharacter>> {
    auth::require_user(&session).await?;
    Ok(Json(
        mal::get_character(&state.pool, &state.http, id).await?,
    ))
}

// ─── Live shipping tracking proxy ─────────────────────────────────────────
//
// Browser → /api/tracking/{carrier}/{number} → server-side fetch against
// the carrier API using a key from env (CORS + auth makes a direct browser
// call impossible). Response is normalised + cached.

async fn tracking_get(
    State(state): State<AppState>,
    session: Session,
    Path((carrier, number)): Path<(String, String)>,
) -> AppResult<Json<tracking::TrackingStatus>> {
    auth::require_user(&session).await?;
    Ok(Json(
        tracking::fetch(
            &state.pool,
            &state.http,
            &state.config.tracking,
            &carrier,
            &number,
        )
        .await?,
    ))
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/tracking/{carrier}/{number}",
            get(tracking_get),
        )
        .route("/external/anilist/search", get(anilist_search))
        // `characters` (plural) for search — kept distinct from the singular
        // `character/{id}` get so the `{id}: i64` extractor never sees "search".
        .route("/external/anilist/characters", get(anilist_character_search))
        .route("/external/anilist/{id}", get(anilist_get))
        .route("/external/anilist/character/{id}", get(anilist_character_get))
        .route("/external/mfc/search", get(mfc_search))
        .route("/external/mfc/parse", post(mfc_parse))
        .route("/external/mfc/{id}", get(mfc_get))
        .route("/external/orzgk/search", get(orzgk_search))
        .route("/external/orzgk/detail", get(orzgk_detail))
        .route("/external/orzgk/wishlist", get(orzgk_wishlist))
        .route("/external/orzgk/wishlist/parse", post(orzgk_wishlist_parse))
        .route("/external/fx", get(fx_latest))
        .route("/external/proxy/stores", get(proxy_stores))
        .route("/external/proxy/search", get(proxy_search))
        .route("/external/proxy/product", get(proxy_product))
        .route("/external/proxy/wishlist", get(proxy_wishlist))
        .route("/external/mal/anime/search", get(mal_anime_search))
        .route("/external/mal/anime/{id}", get(mal_anime_get))
        .route("/external/mal/character/search", get(mal_character_search))
        .route("/external/mal/character/{id}", get(mal_character_get))
}

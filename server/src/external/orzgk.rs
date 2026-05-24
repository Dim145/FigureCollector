//! OrzGK search scraper.
//!
//! OrzGK is a WordPress-powered e-commerce site for collectible figures and
//! GK statues. Its default search endpoint is `/?s=<query>` and returns a
//! fully server-rendered results grid — exactly what we need.
//!
//! The parser is intentionally lenient: anything OrzGK doesn't show ends up
//! as `None`, never breaks the request. Results are cached in `external_lookups`
//! for 24h, keyed by the lowercased query, so a rate-limit hit on the upstream
//! is extremely unlikely.
//!
//! All values surfaced are display-only (raw text + an image URL): we don't
//! attempt to parse "€53.28 – €133.21" into numeric ranges or convert
//! currencies — that's domain logic the user does manually when picking a
//! result to import.

use crate::error::{AppError, AppResult};
use crate::external::cache;
use chrono::Duration;
use scraper::{Html, Selector};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use std::collections::BTreeMap;

const PROVIDER: &str = "orzgk";
const CACHE_TTL_HOURS: i64 = 24;
const SEARCH_TIMEOUT_SECS: u64 = 30;
/// Soft cap on the number of cards we parse from a single search.
const MAX_RESULTS: usize = 24;

/// Spec labels we surface from the product detail page. Order matters: it's
/// the order we walk to pick the *deepest* matching element, and the order
/// the UI lays them out.
const DETAIL_LABELS: &[&str] = &[
    "Brand:",
    "From:",
    "Character:",
    "Type:",
    "Height Range:",
    "Scale:",
    "Feature:",
    "Pre-order Start Date:",
    "Est Released Time:",
];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrzgkItem {
    /// Title as it appears on the card. The studio is usually prefixed
    /// ("GSC - …", "ALTER - …"), see `studio` below.
    pub title: String,
    /// Studio name parsed out of the `<studio> - <name>` prefix when present.
    pub studio: Option<String>,
    /// "pre-order" / "released" / "pre-order close" / "sold out" — raw.
    pub status: Option<String>,
    /// Display string from the card, e.g. "€53.28 – €133.21". Currency
    /// conversion is intentionally out of scope.
    pub price_range: Option<String>,
    /// Best-effort scale extracted from the title ("1/4", "1/7", "non-scale").
    pub scale: Option<String>,
    /// Best resolution we can salvage from the lazy-loaded `<img>` (real
    /// `src` if non-placeholder, else `data-src`, else `srcset` first url).
    pub image_url: Option<String>,
    pub detail_url: String,
}

/// Search OrzGK for `query`, returning up to [`MAX_RESULTS`] cards.
/// Cached in `external_lookups` for 24h per lowercased query.
pub async fn search(
    pool: &PgPool,
    http: &reqwest::Client,
    query: &str,
) -> AppResult<Vec<OrzgkItem>> {
    let q = query.trim();
    if q.len() < 2 {
        return Ok(Vec::new());
    }
    let key = q.to_lowercase();
    let http = http.clone();
    let q = q.to_string();

    cache::cached_fetch::<Vec<OrzgkItem>, _, _>(
        pool,
        PROVIDER,
        "search",
        &key,
        Duration::hours(CACHE_TTL_HOURS),
        move || async move {
            // Build the search URL via reqwest's URL helper so we don't
            // hand-roll the percent-encoding for the query.
            let mut url = reqwest::Url::parse("https://www.orzgk.com/")
                .map_err(|e| AppError::Internal(anyhow::anyhow!("orzgk url: {e}")))?;
            url.query_pairs_mut().append_pair("s", &q);
            let resp = http
                .get(url.clone())
                .header(
                    reqwest::header::USER_AGENT,
                    // Pretend to be a regular browser — orzgk is behind
                    // Cloudflare, which sometimes refuses unknown UAs. We
                    // identify FigureCollector inside the UA token so server
                    // logs still see who's hitting them.
                    "Mozilla/5.0 (compatible; FigureCollector/0.1; +https://github.com/Dim145/FigureCollector)",
                )
                .header(reqwest::header::ACCEPT, "text/html,application/xhtml+xml")
                .header(reqwest::header::ACCEPT_LANGUAGE, "en-US,en;q=0.9,fr;q=0.8")
                // Be explicit: only gzip; we don't have brotli compiled into
                // reqwest, so let Cloudflare know it can't send br.
                .header(reqwest::header::ACCEPT_ENCODING, "gzip, identity")
                .timeout(std::time::Duration::from_secs(SEARCH_TIMEOUT_SECS))
                .send()
                .await
                .map_err(|e| {
                    AppError::Internal(anyhow::anyhow!("orzgk fetch failed: {e}"))
                })?;

            if !resp.status().is_success() {
                return Err(AppError::Internal(anyhow::anyhow!(
                    "orzgk returned HTTP {}",
                    resp.status()
                )));
            }
            let html = resp.text().await.map_err(|e| {
                AppError::Internal(anyhow::anyhow!("orzgk body read failed: {e}"))
            })?;
            Ok(parse_search_html(&html))
        },
    )
    .await
}

/// Pure parser, public so it can be unit-tested against a fixture without a
/// live HTTP roundtrip.
///
/// Anchors on `.product-small.product` cards (Flatsome theme + WooCommerce).
/// Inside each card:
///   - title link:  `.woocommerce-loop-product__title a` (or fall back to
///                  `.woocommerce-LoopProduct-link` with text content)
///   - status:      `.awl-label-text` (Advanced Woo Labels plugin)
///   - price:       `.price-wrapper` (concatenated text — WooCommerce
///                  renders ranges as multiple `.amount` spans)
///   - image:       `img` inside the card, with lazy-load fallbacks
///
/// Class names like `.product-small`, `.woocommerce-LoopProduct-link`,
/// `.price-wrapper` are stable parts of the Flatsome theme + WooCommerce
/// (used across tens of thousands of shops); much less likely to churn
/// than orzgk's specific layout.
pub fn parse_search_html(html: &str) -> Vec<OrzgkItem> {
    let doc = Html::parse_document(html);

    let card_sel = match Selector::parse("div.product-small.product") {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };
    let title_text_sel = Selector::parse(".woocommerce-loop-product__title a").unwrap();
    let loop_link_sel = Selector::parse(".woocommerce-LoopProduct-link").unwrap();
    let status_sel = Selector::parse(".awl-label-text").unwrap();
    let price_sel = Selector::parse(".price-wrapper").unwrap();
    let img_sel = Selector::parse("img").unwrap();

    let mut out: Vec<OrzgkItem> = Vec::new();
    let mut seen = std::collections::HashSet::new();

    for card in doc.select(&card_sel) {
        if out.len() >= MAX_RESULTS {
            break;
        }

        // ---- detail URL + title ----
        let anchor = card
            .select(&title_text_sel)
            .next()
            .or_else(|| card.select(&loop_link_sel).next());
        let (detail_url, title) = match anchor {
            Some(a) => {
                let href = a.value().attr("href").unwrap_or("").to_string();
                let text = a.text().collect::<String>().trim().to_string();
                (href, text)
            }
            None => continue,
        };
        if detail_url.is_empty() || title.is_empty() {
            continue;
        }
        let canonical = detail_url
            .split(['?', '#'])
            .next()
            .unwrap_or(&detail_url)
            .to_string();
        if !canonical.contains("/product/") {
            continue;
        }
        if !seen.insert(canonical.clone()) {
            continue;
        }

        // ---- status (Advanced Woo Labels) ----
        let status = card
            .select(&status_sel)
            .next()
            .map(|n| n.text().collect::<String>().trim().to_string())
            .filter(|s| !s.is_empty());

        // ---- price (WooCommerce range or single value) ----
        // WooCommerce duplicates the price with a `.screen-reader-text` span
        // ("Price range: …"). We strip everything from that marker on so the
        // visible "€53.28 – €133.21" stays clean.
        let price_range = card.select(&price_sel).next().map(|n| {
            let raw = n.text().collect::<String>();
            let cleaned = collapse_ws(&raw);
            cleaned
                .split("Price range")
                .next()
                .unwrap_or(&cleaned)
                .split("Original price was")
                .next()
                .unwrap_or(&cleaned)
                .trim()
                .to_string()
        }).filter(|s| !s.is_empty());

        // ---- studio prefix ----
        let (studio, clean_title) = match title.split_once(" - ") {
            Some((prefix, rest))
                if prefix.len() <= 24 && !prefix.chars().any(|c| c.is_ascii_digit()) =>
            {
                (Some(prefix.trim().to_string()), rest.trim().to_string())
            }
            _ => (None, title.clone()),
        };

        let scale = extract_scale(&clean_title);

        // ---- image (lazy-load aware) ----
        let image_url = card.select(&img_sel).next().and_then(|img| {
            for k in ["data-src", "data-lazy-src", "data-original", "src"] {
                if let Some(v) = img.value().attr(k) {
                    if !v.starts_with("data:") && !v.is_empty() {
                        return Some(v.to_string());
                    }
                }
            }
            img.value().attr("srcset").and_then(|set| {
                set.split(',').next().map(|s| {
                    s.trim()
                        .split_whitespace()
                        .next()
                        .unwrap_or("")
                        .to_string()
                })
            })
        });

        out.push(OrzgkItem {
            title: clean_title,
            studio,
            status,
            price_range,
            scale,
            image_url,
            detail_url: canonical,
        });
    }

    out
}

/// Collapse all whitespace runs into a single space, trim ends. Used so
/// "  €53.28  –  €133.21\n  " comes out as "€53.28 – €133.21".
fn collapse_ws(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut prev_space = false;
    for c in s.chars() {
        if c.is_whitespace() {
            if !prev_space {
                out.push(' ');
            }
            prev_space = true;
        } else {
            out.push(c);
            prev_space = false;
        }
    }
    out.trim().to_string()
}

/// Look for "1/4", "1/6", "1/7", "1/8", "1/10", "1/12", "non-scale" in a
/// title. First match wins; case-insensitive.
fn extract_scale(title: &str) -> Option<String> {
    let lower = title.to_lowercase();
    if lower.contains("non-scale") || lower.contains("non scale") {
        return Some("non-scale".into());
    }
    // 1/N up to a couple digits — handles "1/4 scale", "1/7 …", etc.
    for n in [4u8, 5, 6, 7, 8, 10, 12, 16, 24, 144] {
        let needle = format!("1/{n}");
        if title.contains(&needle) {
            return Some(needle);
        }
    }
    None
}

// =============================================================================
// Detail page (single product) — used by the "import" modal once the user has
// picked a card or pasted a `/product/<slug>/` URL directly.
// =============================================================================

/// A single price line for an orzgk product (or one of its variants). Orzgk
/// uses WooCommerce variable products where the variation matrix is `version`
/// × `payment` (e.g. *Standard Version × deposit*, *Standard Version × full
/// payment*). Each entry of that matrix is one [`OrzgkPrice`].
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrzgkPrice {
    /// `"deposit"`, `"full"`, `"full_payment"` — slug from the variation's
    /// payment attribute, lowercased. `"full"` when the product is a simple
    /// (non-variable) WooCommerce product.
    pub label: String,
    /// Numeric price in the listed currency. We expose this so the SPA can
    /// store it into `msrp_amount` without re-parsing the display string.
    pub amount: f64,
    /// Rendered display value, e.g. `"€53.28"`. Carried alongside `amount`
    /// because orzgk has both euro and dollar mirrors depending on the
    /// visitor's region.
    pub display: String,
    /// ISO 4217 code derived from the currency symbol on the page. `None`
    /// when we can't recognise the symbol.
    pub currency: Option<String>,
}

/// One named version of an orzgk product. For example *Standard Version* and
/// *Pregnancy Version* of a single Tatsumaki listing.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrzgkVersion {
    /// Lowercased slug used as the form key. Stable across renders so the
    /// SPA can identify a re-clicked option.
    pub key: String,
    /// Human-readable label as it appears on orzgk, e.g. `"Standard Version"`.
    pub label: String,
    /// Variant-specific image when WooCommerce returns one in the variations
    /// JSON (it usually does — that's what swap-on-click uses).
    pub image_url: Option<String>,
    /// Every payment-plan price for this version. Always non-empty when the
    /// version comes from the variations JSON; a single full-price entry when
    /// the parser had to fall back.
    pub prices: Vec<OrzgkPrice>,
}

/// Everything we extract from a product detail page. Optional fields mean
/// *the page didn't surface them*, never "unknown" — the SPA can rely on the
/// presence of a value to drive its UI.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrzgkDetail {
    /// Canonical URL we fetched (no query, no fragment).
    pub url: String,
    pub title: String,
    /// `Brand:` row — typically the manufacturer / studio.
    pub brand: Option<String>,
    /// `From:` row — usually the source franchise ("One Punch Man", "Anime Figure").
    pub origin: Option<String>,
    pub character: Option<String>,
    /// `Type:` row — orzgk's free-form category ("GK Statue", "PVC Figure"…).
    pub kind: Option<String>,
    pub height_range: Option<String>,
    pub scale: Option<String>,
    /// `Feature:` row — useful for NSFW detection (`"18+"`) and other flags.
    pub feature: Option<String>,
    pub preorder_start_date: Option<String>,
    pub est_released_time: Option<String>,
    /// Up to a handful of high-res product images, biggest first when we can
    /// tell. The SPA picks the first as `official_image_url`.
    pub images: Vec<String>,
    /// Convenience shortcut — same as `images.first().cloned()`.
    pub primary_image_url: Option<String>,
    pub description: Option<String>,
    /// Non-empty iff the product has WooCommerce variations. When empty the
    /// SPA skips the "pick a version" step and goes straight to the price
    /// chooser using [`Self::prices`].
    pub versions: Vec<OrzgkVersion>,
    /// Prices when no variations exist. Almost always either a single entry
    /// (simple product) or two entries (deposit + full when payment plans
    /// are exposed as plain rows rather than variations).
    pub prices: Vec<OrzgkPrice>,
    /// Single ISO code applicable to all prices — orzgk only renders one
    /// currency per page.
    pub currency: Option<String>,

    // ─── extracted from the long-form description block ──────────────────
    // Orzgk repeats most of the side-panel data inside the description as a
    // `Label: Value` text block. The duplication is genuinely useful: the
    // description block is cleaner ("One Punch Man" vs `From:` returning
    // "Anime Figure - One Punch Man"), and surfaces extra fields the
    // side-panel doesn't (size, material, edition count, etc).
    /// `Product IP:` — cleaner alternative to `From:` (just the franchise).
    pub product_ip: Option<String>,
    /// `Product Role:` — usually identical to `Character:`, kept separate so
    /// the SPA can choose which one to use.
    pub product_role: Option<String>,
    /// `Product Material:` — comma-separated list ("Imported PU, high-grade resin").
    pub product_material: Option<String>,
    /// `Size:` raw string, e.g. `"(H)17 cm x (W)29 cm x (D)13.6 cm"`.
    pub size: Option<String>,
    /// Height in millimeters, parsed from the `(H)nn cm` token of `Size:`.
    pub height_mm: Option<i32>,
    /// `Est. Completion:` — sometimes year+quarter (`"2027 Q4"`), often more
    /// useful than `Est Released Time` for the release date field.
    pub est_completion: Option<String>,
    /// `Limited No Of Unit:` — empty for open editions, a number for limited.
    pub limited_units: Option<String>,
    /// `Special Description:` — free-form, often empty (`"-"`).
    pub special_description: Option<String>,
}

/// Fetch + cache an orzgk product detail page. Cached for [`CACHE_TTL_HOURS`]
/// per canonical URL. Idempotent: re-calling with `?ref=…` or `#anchor` hits
/// the same cache slot.
pub async fn detail(
    pool: &PgPool,
    http: &reqwest::Client,
    url: &str,
) -> AppResult<OrzgkDetail> {
    let canonical = canonical_product_url(url)?;
    let key = canonical.clone();
    let http = http.clone();

    cache::cached_fetch::<OrzgkDetail, _, _>(
        pool,
        PROVIDER,
        "detail",
        &key,
        Duration::hours(CACHE_TTL_HOURS),
        move || async move {
            let resp = http
                .get(&canonical)
                .header(
                    reqwest::header::USER_AGENT,
                    "Mozilla/5.0 (compatible; FigureCollector/0.1; +https://github.com/Dim145/FigureCollector)",
                )
                .header(reqwest::header::ACCEPT, "text/html,application/xhtml+xml")
                .header(reqwest::header::ACCEPT_LANGUAGE, "en-US,en;q=0.9,fr;q=0.8")
                .header(reqwest::header::ACCEPT_ENCODING, "gzip, identity")
                .timeout(std::time::Duration::from_secs(SEARCH_TIMEOUT_SECS))
                .send()
                .await
                .map_err(|e| {
                    AppError::Internal(anyhow::anyhow!("orzgk detail fetch failed: {e}"))
                })?;

            if !resp.status().is_success() {
                return Err(AppError::Internal(anyhow::anyhow!(
                    "orzgk detail returned HTTP {}",
                    resp.status()
                )));
            }
            let html = resp.text().await.map_err(|e| {
                AppError::Internal(anyhow::anyhow!("orzgk detail body read failed: {e}"))
            })?;
            Ok(parse_detail_html(&canonical, &html))
        },
    )
    .await
}

/// Normalise an orzgk product URL: enforce `https://www.orzgk.com/product/…/`
/// shape and strip query / fragment. Rejects everything else so the cache key
/// stays predictable and we don't get tricked into fetching arbitrary pages.
pub fn canonical_product_url(input: &str) -> AppResult<String> {
    let parsed = reqwest::Url::parse(input.trim())
        .map_err(|_| AppError::BadRequest("not a valid URL"))?;
    let host = parsed.host_str().unwrap_or("");
    if host != "www.orzgk.com" && host != "orzgk.com" {
        return Err(AppError::BadRequest(
            "URL must point to www.orzgk.com",
        ));
    }
    if !parsed.path().contains("/product/") {
        return Err(AppError::BadRequest(
            "URL must be an orzgk product page (path must contain /product/)",
        ));
    }
    // Normalise host to canonical www. form and drop ?query / #fragment.
    let mut path = parsed.path().to_string();
    if !path.ends_with('/') {
        path.push('/');
    }
    Ok(format!("https://www.orzgk.com{path}"))
}

/// Pure parser, public so it can be unit-tested against a static fixture.
///
/// The parser is intentionally lenient — anything missing surfaces as `None`,
/// nothing here ever panics on malformed input. Adversarial input gets the
/// same treatment as a partial 200 response from Cloudflare.
pub fn parse_detail_html(url: &str, html: &str) -> OrzgkDetail {
    let doc = Html::parse_document(html);

    let title = best_text(&doc, &["h1.product_title", ".product_title", "h1"])
        .unwrap_or_default();

    // ─── spec rows ───────────────────────────────────────────────────────
    let specs = extract_spec_rows(&doc);
    let f = |k: &str| specs.get(k).cloned();

    // ─── images ──────────────────────────────────────────────────────────
    let images = collect_gallery_images(&doc);
    let primary_image_url = images.first().cloned();

    // ─── description ─────────────────────────────────────────────────────
    let description = best_text(
        &doc,
        &[
            ".woocommerce-product-details__short-description",
            "#tab-description",
            ".product-short-description",
        ],
    );

    // ─── variations / prices ─────────────────────────────────────────────
    let (versions, prices, currency) = parse_variations(&doc, &images);

    // ─── description-block secondary specs ───────────────────────────────
    let desc_specs = description
        .as_deref()
        .map(parse_description_specs)
        .unwrap_or_default();
    let ds = |k: &str| desc_specs.get(k).cloned();
    let size_raw = ds("Size:");
    let height_mm = size_raw.as_deref().and_then(extract_height_mm);

    let mut detail = OrzgkDetail {
        url: url.to_string(),
        title,
        brand: f("Brand:"),
        origin: f("From:"),
        character: f("Character:"),
        kind: f("Type:"),
        height_range: f("Height Range:").or_else(|| ds("Height Range:")),
        scale: f("Scale:").or_else(|| ds("Product Scale:")),
        feature: f("Feature:").or_else(|| ds("Product Features:")),
        preorder_start_date: f("Pre-order Start Date:"),
        est_released_time: f("Est Released Time:"),
        images,
        primary_image_url,
        description,
        versions,
        prices,
        currency,
        product_ip: ds("Product IP:"),
        product_role: ds("Product Role:"),
        product_material: ds("Product Material:"),
        size: size_raw,
        height_mm,
        est_completion: ds("Est. Completion:"),
        limited_units: ds("Limited No Of Unit:"),
        special_description: ds("Special Description:"),
    };
    // Best-effort scale fallback: if the spec row didn't surface one, try the
    // title (e.g. "Crown Studio Tatsumaki 1/6").
    if detail.scale.is_none() {
        detail.scale = extract_scale(&detail.title);
    }
    detail
}

/// Pull out `Label: Value` pairs from the free-form description block. Orzgk
/// flattens this into one long whitespace-collapsed line, so we anchor on
/// label positions and slice between them.
///
/// Values consisting of just `"-"` are dropped (orzgk's placeholder for
/// "no entry"). Returns labels with the trailing colon preserved so callers
/// match the same string they look up.
pub(crate) fn parse_description_specs(desc: &str) -> BTreeMap<String, String> {
    // Order matters only to disambiguate prefixes (none currently), but we
    // sort positions below anyway.
    const LABELS: &[&str] = &[
        "Studio:",
        "Product Name:",
        "Est. Completion:",
        "Size:",
        "Limited No Of Unit:",
        "Product IP:",
        "Product Role:",
        "Product Features:",
        "Product Scale:",
        "Height Range:",
        "Product Material:",
        "Special Description:",
    ];

    // Find every label occurrence with its byte position.
    let mut positions: Vec<(usize, &'static str)> = Vec::new();
    for label in LABELS {
        let mut cursor = 0usize;
        while let Some(rel) = desc[cursor..].find(label) {
            let abs = cursor + rel;
            positions.push((abs, *label));
            cursor = abs + label.len();
        }
    }
    positions.sort_by_key(|(p, _)| *p);

    let mut out = BTreeMap::new();
    for i in 0..positions.len() {
        let (pos, label) = positions[i];
        let value_start = pos + label.len();
        let value_end = positions
            .get(i + 1)
            .map(|(p, _)| *p)
            .unwrap_or(desc.len());
        if value_end <= value_start {
            continue;
        }
        let value = desc[value_start..value_end].trim().to_string();
        if value.is_empty() || value == "-" {
            continue;
        }
        // Insert only the first occurrence per label.
        out.entry(label.to_string()).or_insert(value);
    }
    out
}

/// Parse `"(H)17 cm x (W)29 cm x (D)13.6 cm"` → `170` (mm).
/// The `H` (height) component is the only one we surface — height_mm is what
/// the figure form stores.
pub(crate) fn extract_height_mm(size: &str) -> Option<i32> {
    // We look for `(H)<num> cm` (case-insensitive, optional space).
    let lower = size.to_lowercase();
    let h_marker = lower.find("(h)")?;
    let rest = &size[h_marker + 3..]; // skip "(H)"
    // Read the leading number (digits + optional decimal point).
    let mut chars = rest.chars().peekable();
    // Skip leading whitespace.
    while chars.peek().map(|c| c.is_whitespace()).unwrap_or(false) {
        chars.next();
    }
    let mut buf = String::new();
    while let Some(&c) = chars.peek() {
        if c.is_ascii_digit() || c == '.' || c == ',' {
            buf.push(if c == ',' { '.' } else { c });
            chars.next();
        } else {
            break;
        }
    }
    let cm: f64 = buf.parse().ok()?;
    let mm = (cm * 10.0).round() as i32;
    if mm > 0 && mm < 5_000 { Some(mm) } else { None }
}

/// Walk every element in the document and collect, per spec label, the
/// *shortest* candidate text after the label. Shortest wins because parent
/// containers concatenate every row's text (`"Brand: X From: Y"` etc.) —
/// the leaf cell yields the cleanest extraction.
fn extract_spec_rows(doc: &Html) -> BTreeMap<String, String> {
    let mut candidates: BTreeMap<String, Vec<String>> = BTreeMap::new();
    let any = match Selector::parse("*") {
        Ok(s) => s,
        Err(_) => return BTreeMap::new(),
    };

    for el in doc.select(&any) {
        // Skip <script> / <style> — they're noise and can dwarf real spec rows.
        let tag = el.value().name();
        if matches!(tag, "script" | "style" | "noscript" | "head" | "html") {
            continue;
        }
        let text = collapse_ws(&el.text().collect::<String>());
        if text.is_empty() {
            continue;
        }
        for label in DETAIL_LABELS {
            let Some(rest) = text.strip_prefix(label) else { continue };
            let value = rest.trim().to_string();
            if value.is_empty() || value.len() > 240 {
                continue;
            }
            // Reject if this element actually spans multiple spec rows.
            let has_other = DETAIL_LABELS
                .iter()
                .any(|other| *other != *label && value.contains(other));
            if has_other {
                continue;
            }
            candidates.entry((*label).to_string()).or_default().push(value);
        }
    }

    let mut out = BTreeMap::new();
    for (label, mut values) in candidates {
        values.sort_by_key(|s| s.len());
        if let Some(best) = values.into_iter().next() {
            // Trim trailing colons / dashes some themes append.
            let trimmed = best.trim_end_matches(|c: char| matches!(c, ':' | '-' | '·' | '.')).trim();
            if !trimmed.is_empty() {
                out.insert(label, trimmed.to_string());
            }
        }
    }
    out
}

/// Try a list of CSS selectors in order, return the first non-empty text.
fn best_text(doc: &Html, selectors: &[&str]) -> Option<String> {
    for sel in selectors {
        let Ok(parsed) = Selector::parse(sel) else { continue };
        if let Some(node) = doc.select(&parsed).next() {
            let text = collapse_ws(&node.text().collect::<String>());
            if !text.is_empty() {
                return Some(text);
            }
        }
    }
    None
}

/// Pull every distinct high-res image from the WooCommerce product gallery.
/// Filters out icons / placeholders / tracking pixels using a couple of size
/// heuristics (no `data:` URIs, no obvious thumbnail suffixes).
fn collect_gallery_images(doc: &Html) -> Vec<String> {
    let selectors = [
        // Flatsome / WooCommerce zoom-link wraps the high-res URL in <a href="">.
        ".woocommerce-product-gallery__image > a",
        ".product-gallery-slider a",
        ".woocommerce-product-gallery a",
        // Fallback: <img> in the gallery (lazy-load aware below).
        ".woocommerce-product-gallery img",
        ".product-gallery-slider img",
    ];

    let mut out: Vec<String> = Vec::new();
    let mut seen = std::collections::HashSet::new();

    for sel_str in selectors {
        let Ok(sel) = Selector::parse(sel_str) else { continue };
        for el in doc.select(&sel) {
            let candidate = if el.value().name() == "a" {
                el.value().attr("href").map(|s| s.to_string())
            } else {
                // <img>
                ["data-large_image", "data-src", "data-lazy-src", "src"]
                    .iter()
                    .find_map(|k| el.value().attr(k).map(|s| s.to_string()))
            };
            let Some(u) = candidate else { continue };
            if u.starts_with("data:") || u.is_empty() {
                continue;
            }
            // Drop obvious placeholders / spinners / svgs we don't want.
            let lower = u.to_lowercase();
            if lower.ends_with(".svg") && lower.contains("placeholder") {
                continue;
            }
            if seen.insert(u.clone()) {
                out.push(u);
            }
        }
        // Stop on the first selector that yielded anything — the anchor
        // selectors point at the high-res copies, so once they fire we
        // don't want to start mixing in thumbnails from the `<img>` fallback.
        if !out.is_empty() {
            break;
        }
    }

    out
}

/// Parse WooCommerce variations from the `data-product_variations` attribute
/// (most reliable: it's the JSON the storefront JS itself consumes). Falls
/// back to scraping `.product-page-price` for simple non-variable products.
fn parse_variations(
    doc: &Html,
    fallback_images: &[String],
) -> (Vec<OrzgkVersion>, Vec<OrzgkPrice>, Option<String>) {
    let raw = doc
        .select(&Selector::parse("[data-product_variations]").unwrap())
        .next()
        .and_then(|n| n.value().attr("data-product_variations"))
        .map(|s| s.to_string());

    if let Some(raw_json) = raw {
        // `scraper` already HTML-decodes attribute values, but Cloudflare /
        // Flatsome sometimes double-encodes when there's HTML inside `price_html`.
        // We try the verbatim string first, then a manually-decoded variant.
        let attempts = [raw_json.clone(), html_entity_decode(&raw_json)];
        for attempt in &attempts {
            if let Ok(arr) = serde_json::from_str::<Vec<serde_json::Value>>(attempt) {
                if let Some(parsed) = build_versions_from_json(&arr, fallback_images) {
                    return parsed;
                }
            }
        }
    }

    // ─── simple (non-variable) product fallback ──────────────────────────
    let price_selectors = [
        ".product-page-price .woocommerce-Price-amount",
        ".product-page-price .amount",
        ".summary p.price .woocommerce-Price-amount",
        ".summary p.price .amount",
        "p.price .amount",
    ];
    let mut prices: Vec<OrzgkPrice> = Vec::new();
    let mut currency: Option<String> = None;
    let mut seen = std::collections::HashSet::new();

    for sel_str in price_selectors {
        let Ok(sel) = Selector::parse(sel_str) else { continue };
        for el in doc.select(&sel) {
            let display = collapse_ws(&el.text().collect::<String>());
            if display.is_empty() || !seen.insert(display.clone()) {
                continue;
            }
            let (amount, cur) = parse_price_text(&display);
            if currency.is_none() {
                currency = cur.clone();
            }
            prices.push(OrzgkPrice {
                label: "full".into(),
                amount,
                display,
                currency: cur,
            });
            if prices.len() >= 4 {
                break;
            }
        }
        if !prices.is_empty() {
            break;
        }
    }

    (Vec::new(), prices, currency)
}

/// Turn a parsed `data-product_variations` array into our versions+prices
/// shape. Returns `None` if the array shape is unrecognisable — caller falls
/// back to a simple price scrape.
fn build_versions_from_json(
    arr: &[serde_json::Value],
    fallback_images: &[String],
) -> Option<(Vec<OrzgkVersion>, Vec<OrzgkPrice>, Option<String>)> {
    if arr.is_empty() {
        return None;
    }

    // Preserve declaration order so the SPA shows versions in the same order
    // orzgk's own JS would.
    let mut order: Vec<String> = Vec::new();
    let mut groups: std::collections::HashMap<String, OrzgkVersion> = std::collections::HashMap::new();
    let mut single_currency: Option<String> = None;

    for v in arr {
        let attrs = v.get("attributes").and_then(|a| a.as_object())?;

        // The "version" attribute can be called `attribute_version`,
        // `attribute_pa_version`, or just `attribute_<custom>`. Anything that
        // isn't a payment attribute counts as the version axis.
        let (version_label_opt, payment_label_opt) = split_version_and_payment(attrs);
        let version_label = version_label_opt
            .unwrap_or_else(|| "Default".to_string());
        let payment_raw = payment_label_opt.unwrap_or_else(|| "full".to_string());

        // Amount + currency: prefer the JSON's structured `display_price` over
        // re-parsing the rendered `price_html` (HTML is noisy).
        let amount = v
            .get("display_price")
            .and_then(|x| x.as_f64())
            .or_else(|| v.get("display_regular_price").and_then(|x| x.as_f64()))
            .unwrap_or(0.0);

        let price_html = v.get("price_html").and_then(|x| x.as_str()).unwrap_or("");
        let (display, currency) = if !price_html.is_empty() {
            extract_price_from_html(price_html, amount)
        } else {
            (format_amount(amount), None)
        };
        if single_currency.is_none() {
            single_currency = currency.clone();
        }

        let image_url = v
            .get("image")
            .and_then(|img| img.get("src"))
            .and_then(|s| s.as_str())
            .map(|s| s.to_string())
            .filter(|s| !s.is_empty() && !s.starts_with("data:"));

        if !groups.contains_key(&version_label) {
            order.push(version_label.clone());
            groups.insert(
                version_label.clone(),
                OrzgkVersion {
                    key: slugify(&version_label),
                    label: version_label.clone(),
                    image_url: image_url
                        .clone()
                        .or_else(|| fallback_images.first().cloned()),
                    prices: Vec::new(),
                },
            );
        }
        let group = groups.get_mut(&version_label).unwrap();
        if group.image_url.is_none() {
            group.image_url = image_url;
        }
        group.prices.push(OrzgkPrice {
            label: humanize_payment(&payment_raw),
            amount,
            display,
            currency,
        });
    }

    if groups.is_empty() {
        return None;
    }

    let mut versions: Vec<OrzgkVersion> = order
        .into_iter()
        .filter_map(|k| groups.remove(&k))
        .collect();

    // Sort each version's prices for deterministic UI ("deposit" before "full").
    for v in &mut versions {
        v.prices.sort_by(|a, b| {
            payment_sort_key(&a.label)
                .cmp(&payment_sort_key(&b.label))
                .then(a.amount.partial_cmp(&b.amount).unwrap_or(std::cmp::Ordering::Equal))
        });
    }

    // If we ended up with one "Default" / unnamed version, treat the product
    // as simple (no version chooser, just price chooser).
    if versions.len() == 1 {
        let only = &versions[0];
        if only.label.eq_ignore_ascii_case("Default") || only.label.is_empty() {
            let prices = versions.into_iter().next().map(|v| v.prices).unwrap_or_default();
            return Some((Vec::new(), prices, single_currency));
        }
    }

    Some((versions, Vec::new(), single_currency))
}

/// Inspect a WooCommerce `attributes` object and split it into
/// `(version_label, payment_label)`. The "version" axis is whatever non-
/// payment attribute exists; payment is detected by name (`*payment*`).
fn split_version_and_payment(
    attrs: &serde_json::Map<String, serde_json::Value>,
) -> (Option<String>, Option<String>) {
    let mut version_label: Option<String> = None;
    let mut payment_label: Option<String> = None;

    for (k, v) in attrs {
        let value = v.as_str().unwrap_or("").trim();
        if value.is_empty() {
            continue;
        }
        let key_lower = k.to_lowercase();
        let is_payment = key_lower.contains("payment") || key_lower.contains("pa_payment");
        if is_payment {
            if payment_label.is_none() {
                payment_label = Some(value.to_string());
            }
        } else if version_label.is_none() {
            version_label = Some(value.to_string());
        }
    }

    (version_label, payment_label)
}

/// Extract the price text + currency from a snippet like
/// `<span class="woocommerce-Price-amount amount"><bdi><span class="woocommerce-Price-currencySymbol">€</span>53.28</bdi></span>`.
/// Falls back to a numeric `format_amount(amount)` when parsing the fragment fails.
fn extract_price_from_html(html: &str, amount: f64) -> (String, Option<String>) {
    let frag = Html::parse_fragment(html);
    let amount_sel = match Selector::parse(".woocommerce-Price-amount, .amount") {
        Ok(s) => s,
        Err(_) => return (format_amount(amount), None),
    };
    let cur_sel = Selector::parse(".woocommerce-Price-currencySymbol").ok();

    let display = frag
        .select(&amount_sel)
        .next()
        .map(|n| collapse_ws(&n.text().collect::<String>()))
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| format_amount(amount));

    let currency = cur_sel.as_ref().and_then(|s| {
        frag.select(s)
            .next()
            .map(|n| n.text().collect::<String>().trim().to_string())
            .filter(|s| !s.is_empty())
            .and_then(|sym| currency_code_from_symbol(&sym))
    });

    (display, currency)
}

/// Approximate inverse of WooCommerce's currency rendering — recognises the
/// handful of symbols we actually see on orzgk + sibling shops.
fn currency_code_from_symbol(sym: &str) -> Option<String> {
    let s = sym.trim();
    Some(match s {
        "€" | "EUR" => "EUR",
        "$" | "US$" | "USD" => "USD",
        "£" | "GBP" => "GBP",
        "¥" | "JP¥" | "JPY" => "JPY",
        "CHF" => "CHF",
        "CA$" | "CAD" => "CAD",
        _ => return None,
    }
    .to_string())
}

/// Best-effort numeric + currency extraction from a display string like
/// `"€53.28"`. Used by the simple-product fallback.
fn parse_price_text(text: &str) -> (f64, Option<String>) {
    let currency = currency_code_from_symbol(
        &text
            .chars()
            .find(|c| !c.is_ascii_digit() && !c.is_whitespace() && *c != '.' && *c != ',')
            .map(|c| c.to_string())
            .unwrap_or_default(),
    );

    // Normalise: keep digits + the *last* decimal separator (treat as decimal).
    let digits: String = text
        .chars()
        .filter(|c| c.is_ascii_digit() || *c == '.' || *c == ',')
        .collect();
    let normalized = if digits.matches('.').count() == 1 && digits.matches(',').count() == 0 {
        digits
    } else if digits.matches(',').count() == 1 && digits.matches('.').count() == 0 {
        digits.replace(',', ".")
    } else {
        // Thousands separators present — strip everything but the last separator.
        let cleaned: String = digits.chars().filter(|c| c.is_ascii_digit()).collect();
        cleaned
    };
    let amount = normalized.parse::<f64>().unwrap_or(0.0);
    (amount, currency)
}

fn format_amount(amount: f64) -> String {
    format!("{:.2}", amount)
}

/// Decode the small handful of HTML entities WooCommerce inlines into JSON
/// attribute payloads. Not a full HTML-entity decoder — we don't pull a crate
/// for this.
fn html_entity_decode(s: &str) -> String {
    s.replace("&quot;", "\"")
        .replace("&#34;", "\"")
        .replace("&#039;", "'")
        .replace("&apos;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&")
}

/// Turn `"Standard Version"` → `"standard-version"`. Stable across renders so
/// the SPA can use it as a React key / form value.
fn slugify(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut last_dash = true;
    for c in s.chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c.to_ascii_lowercase());
            last_dash = false;
        } else if !last_dash {
            out.push('-');
            last_dash = true;
        }
    }
    out.trim_matches('-').to_string()
}

/// WooCommerce payment slugs are lowercased and dash-separated. Make them
/// human-readable for display.
fn humanize_payment(raw: &str) -> String {
    let lower = raw.to_lowercase();
    match lower.as_str() {
        "deposit" => "deposit".into(),
        "full" | "full-payment" | "full_payment" | "fullpayment" => "full".into(),
        _ => lower,
    }
}

/// Stable sort key for payment labels — deposit first, then full, then anything
/// else alphabetised.
fn payment_sort_key(label: &str) -> u8 {
    match label.to_lowercase().as_str() {
        "deposit" => 0,
        "full" | "full payment" => 1,
        _ => 2,
    }
}

// -----------------------------------------------------------------------------
// Tests — parser is pure, no live HTTP.
// -----------------------------------------------------------------------------
#[cfg(test)]
mod tests {
    use super::*;

    /// Trimmed-down fixture mirroring WooCommerce + Flatsome's actual DOM
    /// (`div.product-small.product` cards with `.woocommerce-loop-product__title a`
    /// for the link, `.awl-label-text` for the status, `.price-wrapper` for
    /// price ranges).
    const FIXTURE: &str = r##"
        <div class="results">
          <div class="product-small col product type-product post-1 product-type-variable">
            <div class="box-image">
              <a class="woocommerce-LoopProduct-link" href="https://www.orzgk.com/product/gsc-miku-snow-1-7/">
                <img src="data:image/svg+xml,placeholder" data-src="https://img.orzgk.com/wp-content/uploads/m1.jpg">
              </a>
            </div>
            <div class="box-text">
              <div class="title-wrapper">
                <p class="name product-title woocommerce-loop-product__title">
                  <a href="https://www.orzgk.com/product/gsc-miku-snow-1-7/">GSC - Hatsune Miku Snow Princess 1/7 Complete Figure (Licensed)</a>
                </p>
                <span class="awl-product-label"><span class="awl-label-text">pre-order</span></span>
              </div>
              <div class="price-wrapper">
                <span class="amount">€53.28</span>
                <span> – </span>
                <span class="amount">€133.21</span>
              </div>
            </div>
          </div>
          <div class="product-small col product type-product post-2 product-type-variable">
            <div class="box-image">
              <a class="woocommerce-LoopProduct-link" href="https://www.orzgk.com/product/alter-asuka-1-6/?ref=foo">
                <img data-lazy-src="https://img.orzgk.com/wp-content/uploads/a1.jpg">
              </a>
            </div>
            <div class="box-text">
              <p class="name product-title woocommerce-loop-product__title">
                <a href="https://www.orzgk.com/product/alter-asuka-1-6/">ALTER - Asuka Plug Suit Ver. 1/6</a>
              </p>
              <span class="awl-product-label"><span class="awl-label-text">released</span></span>
              <div class="price-wrapper"><span class="amount">€280.00</span></div>
            </div>
          </div>
          <div class="product-small col product type-product post-3">
            <!-- duplicate canonical URL → should dedupe out -->
            <a class="woocommerce-LoopProduct-link" href="https://www.orzgk.com/product/gsc-miku-snow-1-7/?ref=duplicate"></a>
            <p class="name product-title woocommerce-loop-product__title">
              <a href="https://www.orzgk.com/product/gsc-miku-snow-1-7/">GSC - Hatsune Miku Snow Princess 1/7 Complete Figure (Licensed)</a>
            </p>
          </div>
          <a href="https://www.orzgk.com/about">unrelated link, no card → ignored</a>
        </div>
    "##;

    #[test]
    fn parses_two_unique_cards() {
        let items = parse_search_html(FIXTURE);
        assert_eq!(items.len(), 2, "expected dedupe to 2 cards, got {:?}", items);

        let miku = &items[0];
        assert_eq!(miku.studio.as_deref(), Some("GSC"));
        assert!(miku.title.contains("Hatsune Miku Snow Princess"));
        assert_eq!(miku.scale.as_deref(), Some("1/7"));
        assert_eq!(miku.status.as_deref(), Some("pre-order"));
        assert_eq!(miku.price_range.as_deref(), Some("€53.28 – €133.21"));
        assert_eq!(
            miku.image_url.as_deref(),
            Some("https://img.orzgk.com/wp-content/uploads/m1.jpg"),
        );
        assert_eq!(miku.detail_url, "https://www.orzgk.com/product/gsc-miku-snow-1-7/");

        let asuka = &items[1];
        assert_eq!(asuka.studio.as_deref(), Some("ALTER"));
        assert_eq!(asuka.scale.as_deref(), Some("1/6"));
        assert_eq!(asuka.status.as_deref(), Some("released"));
        assert_eq!(asuka.price_range.as_deref(), Some("€280.00"));
        assert_eq!(
            asuka.image_url.as_deref(),
            Some("https://img.orzgk.com/wp-content/uploads/a1.jpg"),
        );
    }

    #[test]
    fn empty_query_returns_empty() {
        // search() returns empty early before any HTTP call; we can't unit-test
        // that without a pool, but the parser handles empty input gracefully.
        let items = parse_search_html("");
        assert!(items.is_empty());
    }

    // ─────────────────────────────────────────────────────────────────────
    // Detail-page parser
    // ─────────────────────────────────────────────────────────────────────

    /// Trimmed-down fixture mirroring an orzgk product page with both
    /// variations + spec rows + gallery + description block. Inspired by the
    /// live Tatsumaki page.
    const DETAIL_FIXTURE: &str = r##"
<!doctype html>
<html><body>
  <div class="product-page">
    <div class="woocommerce-product-gallery">
      <figure class="woocommerce-product-gallery__image">
        <a href="https://img.orzgk.com/wp-content/uploads/big-1.jpg">
          <img data-large_image="https://img.orzgk.com/wp-content/uploads/big-1.jpg" src="https://img.orzgk.com/wp-content/uploads/thumb-1.jpg">
        </a>
      </figure>
      <figure class="woocommerce-product-gallery__image">
        <a href="https://img.orzgk.com/wp-content/uploads/big-2.jpg">
          <img src="https://img.orzgk.com/wp-content/uploads/thumb-2.jpg">
        </a>
      </figure>
    </div>

    <div class="summary">
      <h1 class="product_title">Crown Studio Tatsumaki vs Tentacle One Punch Man</h1>

      <div class="product-meta">
        <p>Brand: <a style="text-decoration: underline;" href="/brand/crown-studio">CROWN Studio (new)</a></p>
        <p>From: <a href="/from/anime-figure">Anime Figure</a></p>
        <p>Character: <a href="/character/tatsumaki">Tatsumaki</a></p>
        <p>Type: <a href="/type/gk-statue">GK Statue</a></p>
        <p>Height Range: <a href="/h/16-25cm">16-25cm</a></p>
        <p>Scale: <a href="/scale/1-6">1/6</a></p>
        <p>Feature: <a href="/feature/18-female">18+ Female</a></p>
        <p>Pre-order Start Date: <span style="color: #FEB333;">2026/05/18</span></p>
        <p>Est Released Time: <span style="color: #FEB333;">2027/12</span></p>
      </div>

      <div id="tab-description">
        <p>Studio: CROWN Studio Product Name: Tatsumaki Est. Completion: 2027 Q4
           Size: (H)17 cm x (W)29 cm x (D)13.6 cm Limited No Of Unit: -
           Product IP: One Punch Man Product Role: Tatsumaki
           Product Features: 18+ Female Product Scale: 1/6
           Height Range: 16-25cm Product Material: Imported PU, high-grade resin
           Special Description: -</p>
      </div>

      <form class="variations_form cart" data-product_variations='[
        {"attributes":{"attribute_version":"Standard Version","attribute_pa_payment":"deposit"},"display_price":53.28,"display_regular_price":53.28,"price_html":"<span class=\"woocommerce-Price-amount amount\"><bdi><span class=\"woocommerce-Price-currencySymbol\">€</span>53.28</bdi></span>","image":{"src":"https://img.orzgk.com/wp-content/uploads/std.jpg"}},
        {"attributes":{"attribute_version":"Standard Version","attribute_pa_payment":"full"},"display_price":133.21,"display_regular_price":133.21,"price_html":"<span class=\"woocommerce-Price-amount amount\"><bdi><span class=\"woocommerce-Price-currencySymbol\">€</span>133.21</bdi></span>","image":{"src":"https://img.orzgk.com/wp-content/uploads/std.jpg"}},
        {"attributes":{"attribute_version":"Pregnancy Version","attribute_pa_payment":"deposit"},"display_price":68.00,"display_regular_price":68.00,"price_html":"<span class=\"woocommerce-Price-amount amount\"><bdi><span class=\"woocommerce-Price-currencySymbol\">€</span>68.00</bdi></span>","image":{"src":"https://img.orzgk.com/wp-content/uploads/preg.jpg"}},
        {"attributes":{"attribute_version":"Pregnancy Version","attribute_pa_payment":"full"},"display_price":170.00,"display_regular_price":170.00,"price_html":"<span class=\"woocommerce-Price-amount amount\"><bdi><span class=\"woocommerce-Price-currencySymbol\">€</span>170.00</bdi></span>","image":{"src":"https://img.orzgk.com/wp-content/uploads/preg.jpg"}}
      ]'>
        <table></table>
      </form>
    </div>
  </div>
</body></html>
    "##;

    #[test]
    fn parses_detail_spec_rows() {
        let d = parse_detail_html(
            "https://www.orzgk.com/product/crown-tatsumaki/",
            DETAIL_FIXTURE,
        );
        assert_eq!(d.title, "Crown Studio Tatsumaki vs Tentacle One Punch Man");
        assert_eq!(d.brand.as_deref(), Some("CROWN Studio (new)"));
        assert_eq!(d.origin.as_deref(), Some("Anime Figure"));
        assert_eq!(d.character.as_deref(), Some("Tatsumaki"));
        assert_eq!(d.kind.as_deref(), Some("GK Statue"));
        assert_eq!(d.height_range.as_deref(), Some("16-25cm"));
        assert_eq!(d.scale.as_deref(), Some("1/6"));
        assert_eq!(d.feature.as_deref(), Some("18+ Female"));
        assert_eq!(d.preorder_start_date.as_deref(), Some("2026/05/18"));
        assert_eq!(d.est_released_time.as_deref(), Some("2027/12"));

        // ─── description-mined fields ────────────────────────────────────
        assert_eq!(d.product_ip.as_deref(), Some("One Punch Man"));
        assert_eq!(d.product_role.as_deref(), Some("Tatsumaki"));
        assert_eq!(
            d.product_material.as_deref(),
            Some("Imported PU, high-grade resin")
        );
        assert_eq!(
            d.size.as_deref(),
            Some("(H)17 cm x (W)29 cm x (D)13.6 cm")
        );
        assert_eq!(d.height_mm, Some(170));
        assert_eq!(d.est_completion.as_deref(), Some("2027 Q4"));
        // "-" placeholders are dropped, never surfaced as values.
        assert!(d.limited_units.is_none());
        assert!(d.special_description.is_none());
    }

    #[test]
    fn parses_detail_versions_and_prices() {
        let d = parse_detail_html(
            "https://www.orzgk.com/product/crown-tatsumaki/",
            DETAIL_FIXTURE,
        );
        assert_eq!(d.versions.len(), 2, "expected two versions, got {:?}", d.versions);
        assert!(d.prices.is_empty(), "simple prices should be empty when versions are present");
        assert_eq!(d.currency.as_deref(), Some("EUR"));

        let std = &d.versions[0];
        assert_eq!(std.label, "Standard Version");
        assert_eq!(std.key, "standard-version");
        assert_eq!(std.prices.len(), 2);
        // sort order: deposit first, then full
        assert_eq!(std.prices[0].label, "deposit");
        assert!((std.prices[0].amount - 53.28).abs() < 1e-6);
        assert_eq!(std.prices[0].currency.as_deref(), Some("EUR"));
        assert_eq!(std.prices[1].label, "full");
        assert!((std.prices[1].amount - 133.21).abs() < 1e-6);

        let preg = &d.versions[1];
        assert_eq!(preg.label, "Pregnancy Version");
        assert_eq!(preg.key, "pregnancy-version");
        assert_eq!(preg.image_url.as_deref(), Some("https://img.orzgk.com/wp-content/uploads/preg.jpg"));
    }

    #[test]
    fn parses_detail_gallery() {
        let d = parse_detail_html(
            "https://www.orzgk.com/product/crown-tatsumaki/",
            DETAIL_FIXTURE,
        );
        assert_eq!(d.images.len(), 2);
        assert_eq!(
            d.images[0],
            "https://img.orzgk.com/wp-content/uploads/big-1.jpg"
        );
        assert_eq!(d.primary_image_url.as_deref(), d.images.first().map(|s| s.as_str()));
    }

    #[test]
    fn canonical_url_strips_query_and_fragment() {
        let u = canonical_product_url(
            "https://www.orzgk.com/product/crown-tatsumaki/?ref=foo#anchor",
        )
        .unwrap();
        assert_eq!(u, "https://www.orzgk.com/product/crown-tatsumaki/");

        // host normalisation: bare orzgk.com → www.orzgk.com
        let u2 = canonical_product_url("https://orzgk.com/product/x/").unwrap();
        assert_eq!(u2, "https://www.orzgk.com/product/x/");
    }

    #[test]
    fn canonical_url_rejects_non_orzgk() {
        assert!(canonical_product_url("https://example.com/product/foo/").is_err());
        assert!(canonical_product_url("not-a-url").is_err());
        assert!(canonical_product_url("https://www.orzgk.com/cart/").is_err());
    }

    /// Simple product (no variations) — parser should fall back to scraping
    /// `.product-page-price` for prices and leave `versions` empty.
    const SIMPLE_FIXTURE: &str = r##"
<!doctype html>
<html><body>
  <h1 class="product_title">Simple Product</h1>
  <p class="product-meta">Brand: <a>GSC</a></p>
  <div class="summary">
    <p class="price product-page-price">
      <span class="woocommerce-Price-amount amount">
        <span class="woocommerce-Price-currencySymbol">€</span>120.00
      </span>
    </p>
  </div>
</body></html>
    "##;

    #[test]
    fn parses_simple_product_price_fallback() {
        let d = parse_detail_html(
            "https://www.orzgk.com/product/simple/",
            SIMPLE_FIXTURE,
        );
        assert!(d.versions.is_empty());
        assert_eq!(d.prices.len(), 1);
        let p = &d.prices[0];
        assert_eq!(p.label, "full");
        assert!((p.amount - 120.0).abs() < 1e-6);
        assert_eq!(p.currency.as_deref(), Some("EUR"));
    }

    #[test]
    fn slugify_handles_punctuation() {
        assert_eq!(super::slugify("Standard Version"), "standard-version");
        assert_eq!(super::slugify("Pregnancy Version"), "pregnancy-version");
        assert_eq!(super::slugify("  Mixed --- chars!"), "mixed-chars");
    }

    #[test]
    fn currency_codes_recognised() {
        assert_eq!(super::currency_code_from_symbol("€"), Some("EUR".into()));
        assert_eq!(super::currency_code_from_symbol("$"), Some("USD".into()));
        assert_eq!(super::currency_code_from_symbol("CA$"), Some("CAD".into()));
        assert_eq!(super::currency_code_from_symbol("¥"), Some("JPY".into()));
        assert_eq!(super::currency_code_from_symbol("???"), None);
    }

    #[test]
    fn parses_description_specs_block() {
        // Real orzgk description (whitespace collapsed by upstream parser).
        let desc = "Studio: CROWN Studio Product Name: Tatsumaki Est. Completion: 2027 Q4 \
                    Size: (H)17 cm x (W)29 cm x (D)13.6 cm Limited No Of Unit: - \
                    Product IP: One Punch Man Product Role: Tatsumaki \
                    Product Features: 18+ Female Product Scale: 1/6 \
                    Height Range: 16-25cm Product Material: Imported PU, high-grade resin \
                    Special Description: -";
        let m = parse_description_specs(desc);
        assert_eq!(m.get("Studio:").map(|s| s.as_str()), Some("CROWN Studio"));
        assert_eq!(m.get("Product Name:").map(|s| s.as_str()), Some("Tatsumaki"));
        assert_eq!(m.get("Est. Completion:").map(|s| s.as_str()), Some("2027 Q4"));
        assert_eq!(
            m.get("Size:").map(|s| s.as_str()),
            Some("(H)17 cm x (W)29 cm x (D)13.6 cm")
        );
        assert_eq!(m.get("Product IP:").map(|s| s.as_str()), Some("One Punch Man"));
        assert_eq!(m.get("Product Role:").map(|s| s.as_str()), Some("Tatsumaki"));
        assert_eq!(
            m.get("Product Material:").map(|s| s.as_str()),
            Some("Imported PU, high-grade resin")
        );
        // "-" placeholders dropped.
        assert!(!m.contains_key("Limited No Of Unit:"));
        assert!(!m.contains_key("Special Description:"));
    }

    #[test]
    fn extracts_height_mm_from_size() {
        assert_eq!(extract_height_mm("(H)17 cm x (W)29 cm x (D)13.6 cm"), Some(170));
        assert_eq!(extract_height_mm("(H)23.5 cm × (W)10 cm"), Some(235));
        assert_eq!(extract_height_mm("(h) 30 cm"), Some(300));
        assert_eq!(extract_height_mm("Height: 30 cm"), None); // no (H) marker
        assert_eq!(extract_height_mm("(H) invalid"), None);
    }

    /// Probe-only test: parses a live HTML snapshot from /tmp if it exists,
    /// prints the parsed detail. Run manually with:
    ///   `cargo test --bin figurecollector-server -- --ignored detail_live_probe --nocapture`
    /// (Skipped by default — relies on a file that the test suite doesn't ship.)
    #[test]
    #[ignore]
    fn detail_live_probe() {
        let path = "/tmp/orzgk_tatsumaki.html";
        let Ok(html) = std::fs::read_to_string(path) else {
            eprintln!("(skipping — {path} not present)");
            return;
        };
        let d = parse_detail_html(
            "https://www.orzgk.com/product/crown-studio-tatsumaki-vs-tentacle-one-punch-man/",
            &html,
        );
        println!("{:#?}", d);
    }
}

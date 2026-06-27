//! Detail subpage: `/product/<slug>/` → full [`super::OrzgkDetail`].
//!
//! The parser leans on three signal sources, in decreasing reliability:
//!
//!   1. **WooCommerce variations JSON** — `data-product_variations` on
//!      the form element. This is what orzgk's own JS consumes, so the
//!      structure is stable: a single array of variant rows with
//!      `attributes`, `display_price`, `price_html`, `image`.
//!   2. **Side-panel spec rows** — short anchor / span pairs like
//!      `Brand: CROWN Studio`. We walk every element and pick the
//!      *shortest* candidate so leaf cells beat the parent container's
//!      concatenated text.
//!   3. **Free-form description block** — orzgk repeats most of the
//!      side-panel data here as a `Label: Value` text stream. Useful for
//!      cleaner copies (`Product IP` vs `From`) and extra fields the
//!      side-panel doesn't surface (`Size`, `Material`, `Limited No Of Unit`).
//!
//! Helpers for each layer live in this file. The split between this and
//! [`super::search`] keeps each parser at a manageable size; the shared
//! `collapse_ws` + `extract_scale` live in [`super::common`].

use super::common::{collapse_ws, extract_scale};
use super::{
    CACHE_TTL_HOURS, OrzgkDetail, OrzgkPrice, OrzgkVersion, PROVIDER, REQUEST_TIMEOUT_SECS,
};
use crate::error::{AppError, AppResult};
use crate::external::cache;
use chrono::Duration;
use scraper::{Html, Selector};
use sqlx::PgPool;
use std::collections::BTreeMap;

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
                .timeout(std::time::Duration::from_secs(REQUEST_TIMEOUT_SECS))
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
        return Err(AppError::BadRequest("URL must point to www.orzgk.com"));
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
        stock_status: parse_stock(&doc),
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
fn parse_description_specs(desc: &str) -> BTreeMap<String, String> {
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
fn extract_height_mm(size: &str) -> Option<i32> {
    // We look for `(H)<num> cm` (case-insensitive, optional space). Scan the
    // ORIGINAL bytes for "(h)"/"(H)" — `"(h)"` is pure ASCII so the match
    // index and `+3` are guaranteed char boundaries. (The previous code took a
    // byte offset from a `to_lowercase()` copy, whose byte length can differ
    // from `size` for non-ASCII input — e.g. 'İ' — and then sliced `size` with
    // it, panicking on a char boundary and killing the price-cron task.)
    let h_marker = size
        .as_bytes()
        .windows(3)
        .position(|w| w.eq_ignore_ascii_case(b"(h)"))?;
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

/// Best-effort aggregate stock signal for the product. Reads the WooCommerce
/// `data-product_variations` JSON — each variation carries `is_in_stock` (bool)
/// and `backorders_allowed` (bool): any variation in stock ⇒ `instock`; else any
/// backorderable ⇒ `onbackorder`; else `outofstock`. For simple (non-variable)
/// products, falls back to the rendered `.stock` element's class. Returns
/// WooCommerce vocab, or `None` when the page surfaced no signal.
fn parse_stock(doc: &Html) -> Option<String> {
    // Variable products: aggregate across the variations JSON (same source as
    // parse_variations — re-read here to keep stock parsing self-contained).
    if let Some(raw) = doc
        .select(&Selector::parse("[data-product_variations]").unwrap())
        .next()
        .and_then(|n| n.value().attr("data-product_variations"))
    {
        let mut had_variations = false;
        for attempt in [raw.to_string(), html_entity_decode(raw)] {
            let Ok(arr) = serde_json::from_str::<Vec<serde_json::Value>>(&attempt) else {
                continue;
            };
            if arr.is_empty() {
                continue;
            }
            had_variations = true;
            let mut saw = false;
            let mut any_in_stock = false;
            let mut any_backorder = false;
            for v in &arr {
                if let Some(b) = v.get("is_in_stock").and_then(|x| x.as_bool()) {
                    saw = true;
                    any_in_stock |= b;
                }
                if v.get("backorders_allowed").and_then(|x| x.as_bool()).unwrap_or(false) {
                    any_backorder = true;
                }
            }
            if saw {
                let s = if any_in_stock {
                    "instock"
                } else if any_backorder {
                    "onbackorder"
                } else {
                    "outofstock"
                };
                return Some(s.to_string());
            }
        }
        // A variable product whose variations carried no stock flag: don't fall
        // back to the simple-product `.stock` DOM cue (it reflects only the
        // default variation, not the aggregate) — report "unknown" instead.
        if had_variations {
            return None;
        }
    }

    // Simple products: WooCommerce renders
    // `<p class="stock in-stock|out-of-stock|available-on-backorder">`. Read the
    // class as a best-effort cue (None when absent → "unknown").
    let stock_sel = Selector::parse("p.stock, .product-page-price .stock").ok()?;
    let el = doc.select(&stock_sel).next()?;
    let class = el.value().attr("class").unwrap_or("").to_lowercase();
    if class.contains("out-of-stock") {
        Some("outofstock".to_string())
    } else if class.contains("backorder") {
        Some("onbackorder".to_string())
    } else if class.contains("in-stock") {
        Some("instock".to_string())
    } else {
        None
    }
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
    let mut groups: std::collections::HashMap<String, OrzgkVersion> =
        std::collections::HashMap::new();
    let mut single_currency: Option<String> = None;

    for v in arr {
        let attrs = v.get("attributes").and_then(|a| a.as_object())?;

        // The "version" attribute can be called `attribute_version`,
        // `attribute_pa_version`, or just `attribute_<custom>`. Anything that
        // isn't a payment attribute counts as the version axis.
        let (version_label_opt, payment_label_opt) = split_version_and_payment(attrs);
        let version_label = version_label_opt.unwrap_or_else(|| "Default".to_string());
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
            let prices = versions
                .into_iter()
                .next()
                .map(|v| v.prices)
                .unwrap_or_default();
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
    Some(
        match s {
            "€" | "EUR" => "EUR",
            "$" | "US$" | "USD" => "USD",
            "£" | "GBP" => "GBP",
            "¥" | "JP¥" | "JPY" => "JPY",
            "CHF" => "CHF",
            "CA$" | "CAD" => "CAD",
            _ => return None,
        }
        .to_string(),
    )
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

    let digits: String = text
        .chars()
        .filter(|c| c.is_ascii_digit() || *c == '.' || *c == ',')
        .collect();
    let amount = normalize_decimal(&digits).parse::<f64>().unwrap_or(0.0);
    (amount, currency)
}

/// Turn a scraped digit-group string into an `f64`-parseable decimal, handling
/// both US (`1,299.99`) and European (`1.299,99`) grouping. The LAST `.`/`,`
/// is the decimal point ONLY when 1–2 digits follow it; a separator followed
/// by exactly 3 digits (or none) is a thousands group and is dropped. So
/// `"¥12,000"` → `"12000"` (was `12.0`), `"€1,299.99"` → `"1299.99"` (was
/// `129999`), `"1.234,56"` → `"1234.56"`, `"53.28"` → `"53.28"`.
fn normalize_decimal(digits: &str) -> String {
    let decimal_pos = digits.rfind(['.', ',']).filter(|&pos| {
        let trailing = digits.len() - pos - 1;
        (1..=2).contains(&trailing)
    });
    let mut out = String::with_capacity(digits.len());
    for (i, c) in digits.char_indices() {
        match c {
            '.' | ',' => {
                if Some(i) == decimal_pos {
                    out.push('.');
                }
                // else: thousands separator — drop it.
            }
            _ => out.push(c),
        }
    }
    out
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

    #[test]
    fn parse_price_text_handles_group_separators() {
        // Thousands separators must NOT be read as decimals (the old bug:
        // "¥12,000" -> 12.0, "€1,299.99" -> 129999.0).
        assert_eq!(parse_price_text("¥12,000").0, 12000.0);
        assert_eq!(parse_price_text("€1,299.99").0, 1299.99);
        assert_eq!(parse_price_text("1.234,56").0, 1234.56); // European
        assert_eq!(parse_price_text("$53.28").0, 53.28);
        assert_eq!(parse_price_text("12,00").0, 12.0); // European decimal
        assert_eq!(parse_price_text("1,234,567").0, 1234567.0);
        assert_eq!(parse_price_text("980").0, 980.0);
    }

    #[test]
    fn extract_height_mm_no_panic_on_non_ascii() {
        // Non-ASCII before the "(H)" marker must not panic the byte slice
        // (the old code indexed `size` with an offset from its lowercased copy).
        assert_eq!(extract_height_mm("İ(H)17 cm"), Some(170));
        assert_eq!(extract_height_mm("(H)25.5 cm x (W)10 cm"), Some(255));
        assert_eq!(extract_height_mm("no marker here"), None);
        // Mixed/upper case marker still matches.
        assert_eq!(extract_height_mm("Height (h) 30 cm"), Some(300));
    }

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
        assert_eq!(slugify("Standard Version"), "standard-version");
        assert_eq!(slugify("Pregnancy Version"), "pregnancy-version");
        assert_eq!(slugify("  Mixed --- chars!"), "mixed-chars");
    }

    #[test]
    fn currency_codes_recognised() {
        assert_eq!(currency_code_from_symbol("€"), Some("EUR".into()));
        assert_eq!(currency_code_from_symbol("$"), Some("USD".into()));
        assert_eq!(currency_code_from_symbol("CA$"), Some("CAD".into()));
        assert_eq!(currency_code_from_symbol("¥"), Some("JPY".into()));
        assert_eq!(currency_code_from_symbol("???"), None);
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

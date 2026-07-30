//! Search subpage: `/?s=<query>` → list of [`super::OrzgkItem`] cards.
//!
//! Parser anchors on `.product-small.product` (Flatsome theme + WooCommerce)
//! so it stays stable across orzgk's own template tweaks. Anything missing
//! surfaces as `None`, never raises.

use super::common::{collapse_ws, extract_scale};
use super::{CACHE_TTL_HOURS, OrzgkItem, PROVIDER};
use crate::error::{AppError, AppResult};
use crate::external::cache;
use chrono::Duration;
use scraper::{Html, Selector};
use sqlx::PgPool;

/// Soft cap on the number of cards we parse from a single search.
const MAX_RESULTS: usize = 24;

/// Search OrzGK for `query`, returning up to [`MAX_RESULTS`] cards.
/// Cached in `external_lookups` for 24h per lowercased query.
pub async fn search(
    pool: &PgPool,
    http: &reqwest::Client,
    fs: &crate::config::FlareSolverrConfig,
    query: &str,
) -> AppResult<Vec<OrzgkItem>> {
    let q = query.trim();
    if q.len() < 2 {
        return Ok(Vec::new());
    }
    let key = q.to_lowercase();
    let http = http.clone();
    let fs = fs.clone();
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
            let html = super::common::fetch_html(&http, &fs, url.as_str()).await?;
            let items = parse_search_html(&html);
            // orzgk (WooCommerce) redirects a search with a single match straight
            // to that product's page, so the card parser finds nothing. Recover
            // the lone result by parsing the product page we landed on.
            if items.is_empty() {
                if let Some(item) = recover_redirected_product(&html) {
                    return Ok(vec![item]);
                }
            }
            Ok(items)
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
        let price_range = card
            .select(&price_sel)
            .next()
            .map(|n| {
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
            })
            .filter(|s| !s.is_empty());

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

/// Recover the single result of a search that orzgk `301`-redirected onto the
/// product page (WooCommerce's "redirect to single search result"). By the time
/// we get here the fetch has followed the redirect, so `html` is the product
/// page and [`parse_search_html`] returned nothing. We rebuild the one
/// [`super::OrzgkItem`] the search should have yielded by reusing the detail
/// parser. Returns `None` when `html` isn't an orzgk product page — i.e. a
/// genuine zero-result search.
fn recover_redirected_product(html: &str) -> Option<super::OrzgkItem> {
    let doc = Html::parse_document(html);
    // A product page canonicalises to `/product/<slug>/`; a search/listing page
    // does not. So a valid product canonical both detects the redirect and
    // gives us the detail URL.
    let canonical = product_canonical(&doc)?;
    let og_image = meta_content(&doc, "og:image");

    let d = super::detail::parse_detail_html(&canonical, html);
    if d.title.is_empty() {
        return None;
    }

    // Mirror the search card's `<studio> - <name>` split; fall back to the
    // product page's `Brand:` row for the studio.
    let (studio, title) = match d.title.split_once(" - ") {
        Some((prefix, rest))
            if prefix.len() <= 24 && !prefix.chars().any(|c| c.is_ascii_digit()) =>
        {
            (Some(prefix.trim().to_string()), rest.trim().to_string())
        }
        _ => (d.brand.clone(), d.title.clone()),
    };

    Some(super::OrzgkItem {
        title,
        studio,
        status: None,
        price_range: price_range_from_detail(&d),
        scale: d.scale.clone(),
        image_url: d.primary_image_url.clone().or(og_image),
        detail_url: canonical,
    })
}

/// Read `<link rel="canonical">`, then `<meta property="og:url">`, returning the
/// first that is a valid orzgk `/product/…` URL (normalised via the detail
/// module's validator).
fn product_canonical(doc: &Html) -> Option<String> {
    let mut candidates: Vec<String> = Vec::new();
    if let Ok(sel) = Selector::parse(r#"link[rel="canonical"]"#) {
        if let Some(href) = doc.select(&sel).next().and_then(|e| e.value().attr("href")) {
            candidates.push(href.to_string());
        }
    }
    if let Some(og) = meta_content(doc, "og:url") {
        candidates.push(og);
    }
    candidates
        .into_iter()
        .find_map(|c| super::detail::canonical_product_url(&c).ok())
}

/// First `<meta property="<prop>">` content value, trimmed + non-empty.
fn meta_content(doc: &Html, prop: &str) -> Option<String> {
    let sel = Selector::parse(&format!(r#"meta[property="{prop}"]"#)).ok()?;
    doc.select(&sel)
        .next()
        .and_then(|e| e.value().attr("content"))
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

/// Build a `"€min – €max"` range (or a single price) from a parsed detail's
/// version / simple prices, mirroring the search card's `price_range`.
fn price_range_from_detail(d: &super::OrzgkDetail) -> Option<String> {
    let mut all: Vec<(f64, &str)> = Vec::new();
    for v in &d.versions {
        for p in &v.prices {
            if p.amount > 0.0 && !p.display.is_empty() {
                all.push((p.amount, p.display.as_str()));
            }
        }
    }
    for p in &d.prices {
        if p.amount > 0.0 && !p.display.is_empty() {
            all.push((p.amount, p.display.as_str()));
        }
    }
    let min = all.iter().copied().min_by(|a, b| a.0.total_cmp(&b.0))?;
    let max = all.iter().copied().max_by(|a, b| a.0.total_cmp(&b.0))?;
    if (min.0 - max.0).abs() < f64::EPSILON {
        Some(min.1.to_string())
    } else {
        Some(format!("{} – {}", min.1, max.1))
    }
}

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

    /// A single-result search that orzgk redirects onto the product page: the
    /// card parser finds nothing, and the recovery path rebuilds the lone item.
    const REDIRECTED_PRODUCT_FIXTURE: &str = r##"
        <!doctype html><html><head>
          <link rel="canonical" href="https://www.orzgk.com/product/figurama-collectors-nanatsu-no-taizai-imashime-no-fukkatsu-ban-king-elite-fandom-1-6-scale-statue-licensed/" />
          <meta property="og:image" content="https://img.orzgk.com/wp-content/uploads/2025/05/b0f91aa6ff1654aaff4aee4a28ca733.png" />
        </head><body class="single-product">
          <div class="summary">
            <h1 class="product_title">Figurama Collectors - Nanatsu no Taizai: Imashime no Fukkatsu Ban &amp; King Elite Fandom 1/6 Scale Statue (Licensed)</h1>
            <p class="product-meta">Brand: <a href="/brand/figurama-collectors">Figurama Collectors</a></p>
            <form class="variations_form cart" data-product_variations='[
              {"attributes":{"attribute_pa_payment":"full"},"display_price":692.93,"price_html":"<span class=\"woocommerce-Price-amount amount\"><bdi><span class=\"woocommerce-Price-currencySymbol\">&euro;</span>692.93</bdi></span>","image":{"src":"https://img.orzgk.com/wp-content/uploads/2025/05/b0f91aa6ff1654aaff4aee4a28ca733.png"}}
            ]'>
            </form>
          </div>
        </body></html>
    "##;

    #[test]
    fn card_parser_finds_nothing_on_a_product_page() {
        // Sanity: a product page has no result cards.
        assert!(parse_search_html(REDIRECTED_PRODUCT_FIXTURE).is_empty());
    }

    #[test]
    fn recovers_single_result_redirected_to_product() {
        let item = recover_redirected_product(REDIRECTED_PRODUCT_FIXTURE)
            .expect("should recover the lone product");
        assert_eq!(
            item.detail_url,
            "https://www.orzgk.com/product/figurama-collectors-nanatsu-no-taizai-imashime-no-fukkatsu-ban-king-elite-fandom-1-6-scale-statue-licensed/"
        );
        assert_eq!(item.studio.as_deref(), Some("Figurama Collectors"));
        assert_eq!(
            item.title,
            "Nanatsu no Taizai: Imashime no Fukkatsu Ban & King Elite Fandom 1/6 Scale Statue (Licensed)"
        );
        assert_eq!(item.scale.as_deref(), Some("1/6"));
        assert_eq!(
            item.image_url.as_deref(),
            Some("https://img.orzgk.com/wp-content/uploads/2025/05/b0f91aa6ff1654aaff4aee4a28ca733.png")
        );
        let pr = item.price_range.expect("price range");
        assert!(pr.contains("692.93"), "got {pr}");
    }

    #[test]
    fn recovery_returns_none_on_a_real_search_page() {
        // The multi-result search page has no /product/ canonical, so recovery
        // must not fire — a genuine zero-result search stays empty.
        assert!(recover_redirected_product(FIXTURE).is_none());
    }
}

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
}

//! Public wishlist parsing for the wlfmc ("WishList for WooCommerce") plugin.
//!
//! orzgk lists can be made public + shared at `/wishlist-2/view/<token>/`.
//! That page renders a table of `tr.wlfmc-table-item` rows (one per wished
//! product), paginated `?pagenum=N` at ~10/page. The public share URL is
//! reachable server-side, so we fetch + follow pagination here. The same pure
//! parser ([`parse_wishlist_html`]) also serves a paste-the-HTML fallback for
//! lists the user keeps private.

use super::common::collapse_ws;
use super::{CACHE_TTL_HOURS, OrzgkWishItem, PROVIDER};
use crate::error::{AppError, AppResult};
use crate::external::cache;
use chrono::Duration;
use scraper::{Html, Selector};
use sqlx::PgPool;

/// Never follow more than this many wishlist pages (safety against a runaway
/// pagination loop). At ~10 items/page this covers a 60-item wishlist.
const MAX_PAGES: u32 = 6;
/// Defensive hard cap on total parsed items.
const MAX_ITEMS: usize = 80;

/// Validate that `raw` is an orzgk wishlist URL and return it parsed. Accepts
/// the public `/wishlist-2/view/<token>/` form as well as the owner's
/// `/my-account/wlfmc-wishlist/...` form (harmless if pasted).
fn validate_wishlist_url(raw: &str) -> AppResult<reqwest::Url> {
    let url = reqwest::Url::parse(raw.trim())
        .map_err(|_| AppError::BadRequest("invalid wishlist URL"))?;
    let host = url.host_str().unwrap_or("");
    if host != "orzgk.com" && host != "www.orzgk.com" {
        return Err(AppError::BadRequest("not an orzgk URL"));
    }
    let path = url.path();
    if !path.contains("wishlist") && !path.contains("wlfmc") {
        return Err(AppError::BadRequest(
            "not a wishlist URL (expected …/wishlist-2/view/<token>/)",
        ));
    }
    Ok(url)
}

/// Fetch a public orzgk wishlist by its share URL, following `?pagenum=N`
/// pagination. Cached 24h per canonical URL in `external_lookups`.
pub async fn fetch_wishlist(
    pool: &PgPool,
    http: &reqwest::Client,
    fs: &crate::config::FlareSolverrConfig,
    url: &str,
) -> AppResult<Vec<OrzgkWishItem>> {
    let base = validate_wishlist_url(url)?;
    let key = base.as_str().trim_end_matches('/').to_lowercase();
    let http = http.clone();
    let fs = fs.clone();

    cache::cached_fetch::<Vec<OrzgkWishItem>, _, _>(
        pool,
        PROVIDER,
        "wishlist",
        &key,
        Duration::hours(CACHE_TTL_HOURS),
        move || async move {
            let mut out: Vec<OrzgkWishItem> = Vec::new();
            let mut seen = std::collections::HashSet::new();

            for page in 1..=MAX_PAGES {
                let mut page_url = base.clone();
                if page > 1 {
                    page_url
                        .query_pairs_mut()
                        .append_pair("pagenum", &page.to_string());
                }

                // Page 1 failing is a hard error; a later page failing just
                // ends the loop with whatever we already gathered.
                let html = match super::common::fetch_html(&http, &fs, page_url.as_str()).await {
                    Ok(html) => html,
                    Err(_) if page > 1 => break,
                    Err(e) => return Err(e),
                };

                let page_items = parse_wishlist_html(&html);
                if page_items.is_empty() {
                    break;
                }
                let mut added = 0usize;
                for it in page_items {
                    if seen.insert(it.detail_url.clone()) {
                        out.push(it);
                        added += 1;
                        if out.len() >= MAX_ITEMS {
                            break;
                        }
                    }
                }
                // No new items on this page (looped past the end / repeated
                // page 1) or we hit the cap → stop.
                if added == 0 || out.len() >= MAX_ITEMS {
                    break;
                }
            }

            Ok(out)
        },
    )
    .await
}

/// Pure parser for the wlfmc wishlist table. Public so it can be unit-tested
/// against a fixture and reused by the paste-HTML fallback route.
pub fn parse_wishlist_html(html: &str) -> Vec<OrzgkWishItem> {
    let doc = Html::parse_document(html);

    let row_sel = match Selector::parse("tr.wlfmc-table-item") {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };
    let name_sel = Selector::parse("a.product-name").unwrap();
    let strong_sel = Selector::parse("strong").unwrap();
    let img_sel = Selector::parse("img").unwrap();
    let dt_sel = Selector::parse("dl.variation dt").unwrap();
    let dd_sel = Selector::parse("dl.variation dd").unwrap();
    let price_sel = Selector::parse(".product-price .woocommerce-Price-amount").unwrap();

    let mut out: Vec<OrzgkWishItem> = Vec::new();
    let mut seen = std::collections::HashSet::new();

    for row in doc.select(&row_sel) {
        // ---- product link + raw title ----
        let anchor = match row.select(&name_sel).next() {
            Some(a) => a,
            None => continue,
        };
        let href = anchor.value().attr("href").unwrap_or("").to_string();
        let raw_title = anchor
            .select(&strong_sel)
            .next()
            .map(|s| s.text().collect::<String>())
            .unwrap_or_else(|| anchor.text().collect::<String>());
        let raw_title = collapse_ws(&raw_title);
        if href.is_empty() || raw_title.is_empty() {
            continue;
        }
        let canonical = href
            .split(['?', '#'])
            .next()
            .unwrap_or(&href)
            .to_string();
        if !canonical.contains("/product/") {
            continue;
        }
        if !seen.insert(canonical.clone()) {
            continue;
        }

        // ---- chosen version (pair the "version:" dt with its dd) ----
        let dts: Vec<String> = row
            .select(&dt_sel)
            .map(|n| collapse_ws(&n.text().collect::<String>()))
            .collect();
        let dds: Vec<String> = row
            .select(&dd_sel)
            .map(|n| collapse_ws(&n.text().collect::<String>()))
            .collect();
        let version = dts
            .iter()
            .position(|d| d.to_lowercase().contains("version"))
            .and_then(|i| dds.get(i))
            .cloned()
            .filter(|s| !s.is_empty());

        // ---- image (lazy: real url in data-src; src is an svg placeholder) ----
        let image_url = row.select(&img_sel).next().and_then(|img| {
            for k in ["data-src", "data-lazy-src", "src"] {
                if let Some(v) = img.value().attr(k) {
                    if !v.starts_with("data:") && !v.is_empty() {
                        return Some(v.to_string());
                    }
                }
            }
            None
        });

        // ---- price (first amount) ----
        let price = row
            .select(&price_sel)
            .next()
            .map(|n| collapse_ws(&n.text().collect::<String>()))
            .filter(|s| !s.is_empty());

        // ---- strip the variant suffix + studio prefix for a clean match name ----
        let de_suffixed = strip_variant_suffix(&raw_title, version.as_deref());
        let (studio, clean_title) = match de_suffixed.split_once(" - ") {
            Some((prefix, rest))
                if prefix.len() <= 24 && !prefix.chars().any(|c| c.is_ascii_digit()) =>
            {
                (Some(prefix.trim().to_string()), rest.trim().to_string())
            }
            _ => (None, de_suffixed.clone()),
        };

        out.push(OrzgkWishItem {
            title: clean_title,
            studio,
            version,
            price,
            image_url,
            detail_url: canonical,
        });
    }

    out
}

/// wlfmc renders the row title as `"<Studio> - <Name> - <Version>, <Payment>"`.
/// Drop the trailing `, <Payment>` and the ` - <Version>` so the remaining
/// text matches the catalogue figure name (which has neither). The studio
/// prefix is split off later by the caller.
fn strip_variant_suffix(title: &str, version: Option<&str>) -> String {
    let mut t = title.to_string();

    // Trailing ", Full Payment" / ", Deposit".
    if let Some(idx) = t.rfind(',') {
        let tail = t[idx + 1..].trim().to_lowercase();
        if tail.contains("payment") || tail.contains("deposit") {
            t.truncate(idx);
        }
    }

    // " - <Version>" (case-insensitive).
    if let Some(v) = version {
        let v = v.trim();
        if !v.is_empty() {
            let lower_t = t.to_lowercase();
            let needle = format!(" - {}", v.to_lowercase());
            if let Some(idx) = lower_t.find(&needle) {
                t.truncate(idx);
            }
        }
    }

    collapse_ws(&t)
}

#[cfg(test)]
mod tests {
    use super::*;

    // Two rows mirroring the real wlfmc markup: one with a version, one without.
    const FIXTURE: &str = r##"
      <table>
        <tr class="wlfmc-table-item">
          <td class="first-column">
            <a class="product-thumbnail" href="https://www.orzgk.com/product/crown-studio-tatsumaki/?attribute_version=Pregnancy+Version&amp;attribute_pa_payment=full-payment">
              <img src="data:image/svg+xml,placeholder" data-src="https://img.orzgk.com/wp-content/uploads/t1.jpg" alt="CROWN" />
            </a>
          </td>
          <td class="center-column">
            <a class="product-name" href="https://www.orzgk.com/product/crown-studio-tatsumaki/?attribute_version=Pregnancy+Version">
              <strong>CROWN Studio - Tatsumaki VS Tentacle One Punch Man - Pregnancy Version, Full Payment</strong>
            </a>
            <div class="product-variation">
              <dl class="variation"><dt>version:</dt><dd>Pregnancy Version</dd><dt>PAYMENT:</dt><dd>Full Payment</dd></dl>
            </div>
            <div class="product-price price"><span class="woocommerce-Price-amount amount"><span>&euro;</span>241.87</span></div>
          </td>
        </tr>
        <tr class="wlfmc-table-item">
          <td class="center-column">
            <a class="product-name" href="https://www.orzgk.com/product/pure-original-homete/?attribute_pa_payment=full-payment">
              <strong>PURE - Original Homete no Pose 1/6 Figure, Full Payment</strong>
            </a>
            <div class="product-price price"><span class="woocommerce-Price-amount amount"><span>&euro;</span>144.95</span></div>
          </td>
        </tr>
      </table>
    "##;

    #[test]
    fn parses_rows_with_and_without_version() {
        let items = parse_wishlist_html(FIXTURE);
        assert_eq!(items.len(), 2, "got {items:?}");

        let a = &items[0];
        assert_eq!(a.studio.as_deref(), Some("CROWN Studio"));
        assert_eq!(a.title, "Tatsumaki VS Tentacle One Punch Man");
        assert_eq!(a.version.as_deref(), Some("Pregnancy Version"));
        assert_eq!(
            a.detail_url,
            "https://www.orzgk.com/product/crown-studio-tatsumaki/"
        );
        assert_eq!(a.image_url.as_deref(), Some("https://img.orzgk.com/wp-content/uploads/t1.jpg"));
        assert!(a.price.as_deref().unwrap().contains("241.87"));

        let b = &items[1];
        assert_eq!(b.studio.as_deref(), Some("PURE"));
        assert_eq!(b.title, "Original Homete no Pose 1/6 Figure");
        assert_eq!(b.version, None);
    }
}

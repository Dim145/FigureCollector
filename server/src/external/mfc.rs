//! MyFigureCollection scraper — Phase 2C skeleton.
//!
//! ### Why this is a skeleton and not a working integration
//!
//! As of 2026-05, MFC's public pages are gated behind a Cloudflare anti-bot
//! challenge that returns HTTP 403 on any client that doesn't run JavaScript
//! and solve the interstitial. The community-run proxy `api.tenji.moe`
//! (https://api.tenji.moe/docs) implements `/v1/item/{id}` but is currently
//! returning HTTP 500 on every lookup.
//!
//! This module keeps the **parser** ready (selectors against MFC's documented
//! HTML structure — `.data-field`, `.item-detail`, etc.) so that the moment a
//! viable fetch path appears (Tenji recovering, a headless-browser sidecar,
//! the user pasting raw HTML themselves), we just plug it into
//! [`fetch_item_html`] and the rest of the pipeline (parse → normalize →
//! cache → import) lights up unchanged.
//!
//! **Since 0.46 there IS a viable fetch path.** The FlareSolverr-compatible
//! solver added for orzgk is host-agnostic, so when `FLARESOLVERR_URL` is set
//! we route MFC item pages through it exactly like orzgk product pages
//! (challenge solved once, `cf_clearance` replayed afterwards). Without a
//! solver configured the module still returns a clean
//! [`AppError::FeatureDisabled`] the UI can surface.
//!
//! **Caveat worth knowing before trusting the output:** the selectors below
//! were written *speculatively* against MFC's documented markup and have never
//! been validated against a live page — nobody could fetch one. The fetch path
//! is now real; the parser is not yet proven. Treat the first live lookups as
//! verification, and expect this file to be the one to edit.

use crate::error::{AppError, AppResult};
use crate::external::cache;
use chrono::Duration;
use scraper::{Html, Selector};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;

const CACHE_TTL_HOURS: i64 = 24;
const PROVIDER: &str = "mfc";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MfcItem {
    pub mfc_id: i64,
    pub name: Option<String>,
    pub manufacturer: Option<String>,
    pub sculptor: Option<String>,
    pub origin: Option<String>,         // "series" / origin label as displayed on MFC
    pub character: Option<String>,
    pub category: Option<String>,        // e.g. "Prepainted", "Nendoroid", "Figma"
    pub release_date: Option<String>,    // raw text — parsing left to caller
    pub release_price_jpy: Option<i64>,
    pub jan: Option<String>,
    pub scale: Option<String>,
    pub height_mm: Option<i32>,
    pub materials: Vec<String>,
    pub official_image_url: Option<String>,
}

/// Try to fetch an MFC item by id, then parse + cache.
///
/// Returns `FeatureDisabled` until a viable fetch path is wired in
/// [`fetch_item_html`]. See module docs.
pub async fn get_item(
    pool: &PgPool,
    http: &reqwest::Client,
    fs: &crate::config::FlareSolverrConfig,
    mfc_id: i64,
) -> AppResult<MfcItem> {
    let http = http.clone();
    let fs = fs.clone();
    cache::cached_fetch(
        pool,
        PROVIDER,
        "item",
        &mfc_id.to_string(),
        Duration::hours(CACHE_TTL_HOURS),
        move || async move {
            let html = fetch_item_html(&http, &fs, mfc_id).await?;
            parse_item_html(mfc_id, &html)
        },
    )
    .await
}

/// Single integration seam. With a FlareSolverr-compatible solver configured
/// (`FLARESOLVERR_URL`) this goes through it — the same path proven live on
/// orzgk, including the cached-clearance replay, so a burst of MFC lookups
/// costs one challenge solve rather than one per item. Without a solver we
/// refuse cleanly instead of hammering Cloudflare with requests it will 403.
async fn fetch_item_html(
    http: &reqwest::Client,
    fs: &crate::config::FlareSolverrConfig,
    mfc_id: i64,
) -> AppResult<String> {
    let Some(endpoint) = fs.url.as_deref() else {
        return Err(AppError::FeatureDisabled(
            "MFC lookups need a Cloudflare solver — set FLARESOLVERR_URL (FlareSolverr, \
             Byparr, …). Manual entry and the paste-HTML path are unaffected.",
        ));
    };
    let url = format!("https://myfigurecollection.net/item/{mfc_id}");
    crate::external::flaresolverr::fetch_html(http, endpoint, &url, fs.max_timeout_ms).await
}

/// MFC renders an entity next to its role, separated by a non-breaking space:
/// `"Kotobukiya\u{a0}as Manufacturer"`. Keep the entity, drop the role.
fn strip_role(v: &str) -> &str {
    let v = v.trim();
    for sep in ["\u{a0}as ", " as "] {
        if let Some(idx) = v.find(sep) {
            return v[..idx].trim();
        }
    }
    v
}

/// First `MM/DD/YYYY` in a Releases row → ISO `YYYY-MM-DD`. Returned as text:
/// MFC also publishes partial dates, and inventing a day would be worse than
/// handing the caller what was printed.
fn parse_release_date(v: &str) -> Option<String> {
    let bytes: Vec<char> = v.chars().collect();
    for i in 0..bytes.len().saturating_sub(9) {
        let w: String = bytes[i..i + 10].iter().collect();
        let p: Vec<&str> = w.split('/').collect();
        if p.len() == 3 && p[0].len() == 2 && p[1].len() == 2 && p[2].len() == 4 {
            if p.iter().all(|s| s.chars().all(|c| c.is_ascii_digit())) {
                return Some(format!("{}-{}-{}", p[2], p[0], p[1]));
            }
        }
    }
    None
}

/// `"… 12,800 JPY ( USD ) …"` → `12800`. Only a JPY-tagged amount counts: the
/// row also shows a converted figure, and silently storing dollars as yen
/// would poison every price surface downstream.
fn parse_release_price_jpy(v: &str) -> Option<i64> {
    let idx = v.find("JPY")?;
    let head = &v[..idx];
    let digits: String = head
        .chars()
        .rev()
        .take_while(|c| c.is_ascii_digit() || *c == ',' || c.is_whitespace())
        .filter(|c| c.is_ascii_digit())
        .collect();
    if digits.is_empty() {
        return None;
    }
    digits.chars().rev().collect::<String>().parse().ok()
}

/// A bare 13- or 12-digit run is the JAN/EAN.
fn parse_jan(v: &str) -> Option<String> {
    let mut run = String::new();
    for c in v.chars().chain(std::iter::once(' ')) {
        if c.is_ascii_digit() {
            run.push(c);
        } else {
            if run.len() == 13 || run.len() == 12 {
                return Some(run);
            }
            run.clear();
        }
    }
    None
}

/// `"1/ 10   H= 183 mm"` → `"1/10"`. MFC pads the fraction with spaces.
fn parse_scale(v: &str) -> Option<String> {
    let idx = v.find('/')?;
    let before: String = v[..idx]
        .chars()
        .rev()
        .take_while(|c| c.is_ascii_digit())
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();
    let after: String = v[idx + 1..]
        .chars()
        .skip_while(|c| c.is_whitespace())
        .take_while(|c| c.is_ascii_digit())
        .collect();
    if before.is_empty() || after.is_empty() {
        return None;
    }
    Some(format!("{before}/{after}"))
}

/// `"H= 183 mm"` → `183`. Prefers the `H=` marker so the parenthesised inch /
/// 1:1 conversions in the same string can't be mistaken for the height; falls
/// back to the first `<n> mm` for a plain "Height" row.
fn parse_height_mm(v: &str) -> Option<i32> {
    let tail = match v.find("H=").or_else(|| v.find("H =")) {
        Some(idx) => &v[idx..],
        None => v,
    };
    let digits: String = tail
        .chars()
        .skip_while(|c| !c.is_ascii_digit())
        .take_while(|c| c.is_ascii_digit())
        .collect();
    digits.parse().ok().filter(|&h: &i32| h > 0 && h < 5000)
}

/// Parse an MFC item-page HTML string into our normalised [`MfcItem`].
///
/// Robust to missing fields: any property MFC doesn't display lands as `None`.
/// Selector strategy uses MFC's documented `.data-field` rows plus a few
/// well-known anchors (item picture, JAN field, etc.). When MFC reshuffles
/// their template, this is the file to edit.
pub fn parse_item_html(mfc_id: i64, html: &str) -> AppResult<MfcItem> {
    let doc = Html::parse_document(html);

    let title = select_text(&doc, "h1 a, h1 span, .title").map(|s| s.trim().to_string());

    let mut item = MfcItem {
        mfc_id,
        name: title,
        manufacturer: None,
        sculptor: None,
        origin: None,
        character: None,
        category: None,
        release_date: None,
        release_price_jpy: None,
        jan: None,
        scale: None,
        height_mm: None,
        materials: vec![],
        official_image_url: select_attr(&doc, "div.item-picture img, .item-picture-active img", "src")
            .map(str::to_string),
    };

    // MFC item-detail layout: rows of <div class="data-field">
    //   <span class="data-label">Manufacturer</span>
    //   <div class="data-value">...</div>
    // We walk each row and dispatch on the label text.
    if let Ok(row_sel) = Selector::parse("div.data-field") {
        for row in doc.select(&row_sel) {
            let label = row
                .select(&Selector::parse(".data-label").unwrap())
                .next()
                .map(|n| n.text().collect::<String>().trim().to_lowercase())
                .unwrap_or_default();
            let value_el = row.select(&Selector::parse(".data-value").unwrap()).next();
            let value = value_el
                .map(|n| n.text().collect::<String>().trim().to_string())
                .filter(|s| !s.is_empty());

            match label.as_str() {
                // MFC writes an entity plus its role, separated by a
                // non-breaking space: "Kotobukiya\u{a0}as Manufacturer".
                "company" | "companies" | "manufacturer" => {
                    item.manufacturer = value.as_deref().map(strip_role).map(str::to_string)
                }
                "sculptor" | "sculptors" => {
                    item.sculptor = value.as_deref().map(strip_role).map(str::to_string)
                }
                "origin" | "origins" => item.origin = value,
                "character" | "characters" => item.character = value,
                "category" | "categories" => item.category = value,
                // One "Releases" row carries date, edition, price and barcode:
                //   "09/27/2017 as Standard (Japan) 12,800 JPY ( USD ) • 4934054903269"
                "releases" | "release" | "release date" => {
                    if let Some(v) = value.as_deref() {
                        item.release_date = parse_release_date(v);
                        item.release_price_jpy = parse_release_price_jpy(v);
                        item.jan = item.jan.take().or_else(|| parse_jan(v));
                    }
                }
                "release price" => {
                    item.release_price_jpy =
                        value.as_deref().and_then(parse_release_price_jpy);
                }
                "jan" | "barcode" => item.jan = value,
                // A numeric fraction gets normalised ("1/ 10" → "1/10"); a
                // label like "Non-scale" is a legitimate value and passes
                // through untouched.
                "scale" | "scaling" => {
                    item.scale = value
                        .as_deref()
                        .and_then(|v| parse_scale(v).or_else(|| {
                            let v = v.trim();
                            (!v.is_empty()).then(|| v.to_string())
                        }))
                }
                // "1/ 10   H= 183 mm (7.14in, 1:1=1.83m)" — scale AND height.
                "height" | "dimensions" => {
                    if let Some(v) = value.as_deref() {
                        if item.scale.is_none() {
                            item.scale = parse_scale(v);
                        }
                        item.height_mm = parse_height_mm(v);
                    }
                }
                "material" | "materials" => {
                    if let Some(v) = value {
                        item.materials = v
                            .split(|c: char| c == ',' || c == '/' || c == '·')
                            .map(|s| s.trim().to_string())
                            .filter(|s| !s.is_empty())
                            .collect();
                    }
                }
                _ => {}
            }
        }
    }

    Ok(item)
}

/// Parse MFC item HTML pasted by the user — the "import-by-paste" path that
/// sidesteps the Cloudflare wall (no fetch, just parse what the user copied).
/// Extracts the item id from the markup when present so the imported figure
/// can carry its `mfc_id`.
pub fn parse_pasted(html: &str) -> AppResult<MfcItem> {
    let mfc_id = extract_mfc_id(html).unwrap_or(0);
    parse_item_html(mfc_id, html)
}

/// Best-effort extraction of the MFC item id from a pasted page — finds the
/// first `.../item/<digits>` occurrence (canonical URL, og:url, breadcrumb…).
fn extract_mfc_id(html: &str) -> Option<i64> {
    const NEEDLE: &str = "/item/";
    let mut from = 0;
    while let Some(pos) = html[from..].find(NEEDLE) {
        let start = from + pos + NEEDLE.len();
        let digits: String = html[start..].chars().take_while(|c| c.is_ascii_digit()).collect();
        if let Ok(id) = digits.parse::<i64>() {
            return Some(id);
        }
        from = start + 1;
    }
    None
}

fn select_text(doc: &Html, sel: &str) -> Option<String> {
    let s = Selector::parse(sel).ok()?;
    doc.select(&s)
        .next()
        .map(|n| n.text().collect::<String>())
        .filter(|s| !s.trim().is_empty())
}

fn select_attr<'a>(doc: &'a Html, sel: &str, attr: &str) -> Option<&'a str> {
    let s = Selector::parse(sel).ok()?;
    doc.select(&s).next().and_then(|n| n.value().attr(attr))
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIXTURE: &str = r#"
        <!doctype html>
        <html><body>
          <h1><a>Nendoroid Hatsune Miku: Snow Princess Ver.</a></h1>
          <div class="item-picture-active"><img src="https://mfc.example/img.webp"></div>
          <div class="data-field"><span class="data-label">Company</span><div class="data-value">Good Smile Company</div></div>
          <div class="data-field"><span class="data-label">Sculptor</span><div class="data-value">Toytec D.T.C</div></div>
          <div class="data-field"><span class="data-label">Origin</span><div class="data-value">Vocaloid</div></div>
          <div class="data-field"><span class="data-label">Character</span><div class="data-value">Hatsune Miku</div></div>
          <div class="data-field"><span class="data-label">Category</span><div class="data-value">Nendoroid</div></div>
          <div class="data-field"><span class="data-label">Release date</span><div class="data-value">December 2024</div></div>
          <div class="data-field"><span class="data-label">Release price</span><div class="data-value">5,800 JPY</div></div>
          <div class="data-field"><span class="data-label">JAN</span><div class="data-value">4580590127553</div></div>
          <div class="data-field"><span class="data-label">Scale</span><div class="data-value">Non-scale</div></div>
          <div class="data-field"><span class="data-label">Height</span><div class="data-value">100 mm</div></div>
          <div class="data-field"><span class="data-label">Materials</span><div class="data-value">PVC, ABS</div></div>
        </body></html>
    "#;

    #[test]
    fn parser_extracts_known_fields() {
        let item = parse_item_html(1856, FIXTURE).unwrap();
        assert_eq!(item.mfc_id, 1856);
        assert_eq!(item.manufacturer.as_deref(), Some("Good Smile Company"));
        assert_eq!(item.sculptor.as_deref(), Some("Toytec D.T.C"));
        assert_eq!(item.origin.as_deref(), Some("Vocaloid"));
        assert_eq!(item.character.as_deref(), Some("Hatsune Miku"));
        assert_eq!(item.category.as_deref(), Some("Nendoroid"));
        assert_eq!(item.jan.as_deref(), Some("4580590127553"));
        assert_eq!(item.scale.as_deref(), Some("Non-scale"));
        assert_eq!(item.height_mm, Some(100));
        assert_eq!(item.release_price_jpy, Some(5800));
        assert_eq!(item.materials, vec!["PVC", "ABS"]);
        assert_eq!(
            item.official_image_url.as_deref(),
            Some("https://mfc.example/img.webp")
        );
    }
}

#[cfg(test)]
mod real_layout_tests {
    use super::*;

    /// Trimmed from a real item page fetched through the solver — MFC pads the
    /// scale fraction, joins an entity to its role with a non-breaking space,
    /// and crams date + edition + price + barcode into one "Releases" row.
    const FIXTURE: &str = "\
<html><body>\
<h1><a>Star Wars: The Force Awakens - Han Solo - ARTFX+ - 1/10 - 2 Pack (Kotobukiya)</a></h1>\
<div class=\"item-picture\"><img src=\"https://static.myfigurecollection.net/upload/items/1/500000-d78c4.jpg\"></div>\
<div class=\"data-field\"><span class=\"data-label\">Category</span><div class=\"data-value\">Prepainted</div></div>\
<div class=\"data-field\"><span class=\"data-label\">Origin</span><div class=\"data-value\">Star Wars: The Force Awakens</div></div>\
<div class=\"data-field\"><span class=\"data-label\">Character</span><div class=\"data-value\">Han Solo</div></div>\
<div class=\"data-field\"><span class=\"data-label\">Company</span><div class=\"data-value\">Kotobukiya\u{a0}as Manufacturer</div></div>\
<div class=\"data-field\"><span class=\"data-label\">Releases</span><div class=\"data-value\">09/27/2017 as Standard (Japan) 12,800 JPY ( USD ) \u{2022} 4934054903269</div></div>\
<div class=\"data-field\"><span class=\"data-label\">Materials</span><div class=\"data-value\">ABS , Magnet , PVC</div></div>\
<div class=\"data-field\"><span class=\"data-label\">Dimensions</span><div class=\"data-value\">1/ 10 \u{a0} H= 183 mm (7.14in, 1:1=1.83m)</div></div>\
</body></html>";

    #[test]
    fn parses_a_real_item_layout() {
        let item = parse_item_html(500_000, FIXTURE).expect("parse");
        assert_eq!(item.category.as_deref(), Some("Prepainted"));
        assert_eq!(item.origin.as_deref(), Some("Star Wars: The Force Awakens"));
        assert_eq!(item.character.as_deref(), Some("Han Solo"));
        // The " as Manufacturer" role suffix must not leak into the name.
        assert_eq!(item.manufacturer.as_deref(), Some("Kotobukiya"));
        assert_eq!(item.release_date.as_deref(), Some("2017-09-27"));
        assert_eq!(item.release_price_jpy, Some(12_800));
        assert_eq!(item.jan.as_deref(), Some("4934054903269"));
        assert_eq!(item.scale.as_deref(), Some("1/10"));
        assert_eq!(item.height_mm, Some(183));
        assert_eq!(item.materials, vec!["ABS", "Magnet", "PVC"]);
        assert!(item.official_image_url.is_some());
    }

    #[test]
    fn price_only_counts_a_jpy_amount() {
        // The row also prints a converted figure; storing dollars as yen would
        // poison every price surface downstream.
        assert_eq!(parse_release_price_jpy("1,200 JPY ( 8 USD )"), Some(1200));
        assert_eq!(parse_release_price_jpy("49.99 USD"), None);
    }

    #[test]
    fn height_is_anchored_on_the_H_marker() {
        // Not the 7.14in / 1:1 conversions in the same string.
        assert_eq!(parse_height_mm("1/ 10 H= 183 mm (7.14in, 1:1=1.83m)"), Some(183));
        assert_eq!(parse_height_mm("no marker"), None);
    }

    #[test]
    fn scale_survives_mfc_padding() {
        assert_eq!(parse_scale("1/ 10 \u{a0} H= 183 mm"), Some("1/10".into()));
        assert_eq!(parse_scale("non-scale"), None);
    }

    #[test]
    fn role_suffix_is_stripped_on_both_separators() {
        assert_eq!(strip_role("Kotobukiya\u{a0}as Manufacturer"), "Kotobukiya");
        assert_eq!(strip_role("Good Smile Company as Manufacturer"), "Good Smile Company");
        assert_eq!(strip_role("Alter"), "Alter");
    }
}

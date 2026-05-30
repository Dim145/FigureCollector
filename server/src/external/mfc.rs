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
//! Callers that try to use this today get a clean [`AppError::FeatureDisabled`]
//! they can surface in the UI.

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
    _http: &reqwest::Client,
    mfc_id: i64,
) -> AppResult<MfcItem> {
    cache::cached_fetch(
        pool,
        PROVIDER,
        "item",
        &mfc_id.to_string(),
        Duration::hours(CACHE_TTL_HOURS),
        || async move {
            let html = fetch_item_html(mfc_id).await?;
            parse_item_html(mfc_id, &html)
        },
    )
    .await
}

/// Single integration seam. Today: errors out cleanly. Tomorrow: swap with
/// a Tenji client or a headless-browser sidecar without touching the parser.
async fn fetch_item_html(_mfc_id: i64) -> AppResult<String> {
    Err(AppError::FeatureDisabled(
        "MFC scraping is currently disabled — Cloudflare blocks direct HTTP. \
         Wire a working fetcher into external::mfc::fetch_item_html (Tenji \
         proxy when it recovers, or a headless-browser sidecar).",
    ))
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
                "company" | "companies" | "manufacturer" => item.manufacturer = value,
                "sculptor" | "sculptors" => item.sculptor = value,
                "origin" | "origins" => item.origin = value,
                "character" | "characters" => item.character = value,
                "category" | "categories" => item.category = value,
                "release date" => item.release_date = value,
                "release price" => {
                    item.release_price_jpy = value
                        .as_deref()
                        .and_then(|v| {
                            v.chars()
                                .filter(|c| c.is_ascii_digit())
                                .collect::<String>()
                                .parse::<i64>()
                                .ok()
                        });
                }
                "jan" | "barcode" => item.jan = value,
                "scale" | "scaling" => item.scale = value,
                "height" | "dimensions" => {
                    if let Some(v) = &value {
                        // "100mm" / "10cm" / "1/7 — 220 mm"
                        let digits: String = v.chars().filter(|c| c.is_ascii_digit()).collect();
                        item.height_mm = digits.parse::<i32>().ok();
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

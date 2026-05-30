//! OrzGK metadata provider.
//!
//! OrzGK is a WordPress-powered e-commerce site for collectible figures and
//! GK statues. We surface two flows:
//!
//!   - `search` (in [`search`]) — `/?s=<query>` → list of product cards.
//!     Cached 24h per lowercased query in `external_lookups`. Parser is
//!     anchored on the Flatsome theme's stable class names.
//!   - `detail` (in [`detail`]) — `/product/<slug>/` → full product page
//!     with side-panel specs, gallery, WooCommerce variations JSON, and a
//!     description block whose `Label: Value` text we mine for the fields
//!     the side-panel doesn't surface (size, material, edition count).
//!
//! Shared bits (whitespace normalisation, scale extraction) live in
//! [`common`]. Both subpages produce the same `OrzgkItem` / `OrzgkDetail`
//! shapes defined here.
//!
//! Both fetchers run through `external::cache::cached_fetch`, so concurrent
//! callers for the same query coalesce to a single upstream call.

use serde::{Deserialize, Serialize};

mod common;
mod detail;
mod search;
mod wishlist;

// Only the entry-point fetchers escape the module; the pure parsers
// (`parse_search_html`, `parse_detail_html`, `canonical_product_url`)
// stay reachable only by the test modules in each submodule.
pub use detail::detail;
pub use search::search;
// `parse_wishlist_html` is public so the paste-the-HTML fallback route can
// reuse the exact same parser as the server-side fetch path.
pub use wishlist::{fetch_wishlist, parse_wishlist_html};

/// Cache provider name used in `external_lookups.provider`.
const PROVIDER: &str = "orzgk";
const CACHE_TTL_HOURS: i64 = 24;
/// Wall-clock cap for any single upstream call. Generous because orzgk
/// sits behind Cloudflare and is occasionally slow on cold cache.
const REQUEST_TIMEOUT_SECS: u64 = 30;

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

/// One row of a public orzgk wishlist (wlfmc plugin, `tr.wlfmc-table-item`).
/// Lighter than [`OrzgkItem`] — the bulk importer only needs enough to match
/// against the catalogue and, for new figures, the product URL to fetch full
/// detail at commit time.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrzgkWishItem {
    /// Product name with the `<studio> - ` prefix and the ` - <version>,
    /// <payment>` suffix stripped, so it matches the catalogue cleanly.
    pub title: String,
    /// Studio / brand parsed from the `<studio> - …` prefix when present.
    pub studio: Option<String>,
    /// The variant the user wished (`"Pregnancy Version"`), from the row's
    /// `dl.variation`. Used to pre-select the version when creating the figure.
    pub version: Option<String>,
    /// Display price as shown in the wishlist row, e.g. `"€241.87"`.
    pub price: Option<String>,
    /// Real (de-lazyloaded) thumbnail URL.
    pub image_url: Option<String>,
    /// Canonical `/product/<slug>/` URL (query + fragment stripped).
    pub detail_url: String,
}

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

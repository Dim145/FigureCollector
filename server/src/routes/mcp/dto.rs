//! Tool argument types.
//!
//! Kept separate from the domain's own query structs on purpose: these are the
//! *public* schema an agent sees, and decoupling them means a new column on a
//! domain type can't widen the MCP surface by accident. They derive
//! `JsonSchema` (that's what `tools/list` advertises) and `Serialize` (that's
//! what the audit trail digests).

use rmcp::schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// How many rows a list tool returns when the caller doesn't say.
pub const DEFAULT_LIMIT: i64 = 50;
/// Hard ceiling, whatever the caller asks for. Several domain list functions
/// return an entire collection unbounded; the cap lives here so one call can't
/// dump 500 pieces into a context window.
pub const MAX_LIMIT: i64 = 200;

pub fn clamp_limit(limit: Option<i64>) -> i64 {
    limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT)
}

pub fn clamp_offset(offset: Option<i64>) -> i64 {
    offset.unwrap_or(0).max(0)
}

/// A page of results plus what it was a page *of* — an agent that only sees 50
/// of 500 rows and no total will happily conclude the collection has 50 pieces.
#[derive(Debug, Serialize, JsonSchema)]
pub struct Page<T> {
    /// Rows in this page.
    pub items: Vec<T>,
    /// How many rows match in total, ignoring `limit`/`offset`.
    pub total: usize,
    pub limit: i64,
    pub offset: i64,
    /// True when rows remain past this page.
    pub has_more: bool,
}

impl<T> Page<T> {
    /// Slice an unbounded domain result into one page.
    pub fn of(all: Vec<T>, limit: i64, offset: i64) -> Self {
        let total = all.len();
        let start = (offset as usize).min(total);
        let end = (start + limit as usize).min(total);
        let items: Vec<T> = all.into_iter().skip(start).take(end - start).collect();
        Self {
            has_more: end < total,
            items,
            total,
            limit,
            offset,
        }
    }
}

#[derive(Debug, Deserialize, Serialize, JsonSchema)]
pub struct SearchCatalogue {
    /// Case-insensitive substring of the figure name.
    pub q: Option<String>,
    /// Exact figure-type id, as listed by `list_catalogue_facets`.
    pub figure_type: Option<String>,
    /// Manufacturer slug or exact name.
    pub manufacturer: Option<String>,
    /// One appearance tag, matched whole (not as a substring).
    pub tag: Option<String>,
    /// 1–200, default 50.
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

#[derive(Debug, Deserialize, Serialize, JsonSchema)]
pub struct FigureId {
    pub figure_id: uuid::Uuid,
}

#[derive(Debug, Deserialize, Serialize, JsonSchema)]
pub struct Barcode {
    /// JAN / EAN barcode, digits only.
    pub jan: String,
}

#[derive(Debug, Deserialize, Serialize, JsonSchema)]
pub struct DuplicateProbe {
    /// Candidate figure name. Needs at least 3 characters unless `jan` is given.
    pub name: String,
    /// JAN / EAN, if known — an exact barcode match is proof of identity.
    pub jan: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, JsonSchema)]
pub struct MatchQuery {
    pub name: String,
    /// Narrows the match. Name alone is often ambiguous — the same character
    /// exists a hundred times over across makers.
    pub manufacturer: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, JsonSchema)]
pub struct MatchFigures {
    /// Up to 60 names to resolve in one call.
    pub queries: Vec<MatchQuery>,
}

/// Which kind of catalogue entity a lookup or browse concerns.
#[derive(Debug, Clone, Copy, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum EntityKind {
    Manufacturer,
    Series,
    Character,
    Sculptor,
    Material,
}

#[derive(Debug, Deserialize, Serialize, JsonSchema)]
pub struct ListEntities {
    pub kind: EntityKind,
}

#[derive(Debug, Deserialize, Serialize, JsonSchema)]
pub struct BrowseEntity {
    /// `manufacturer`, `series` or `character`. Sculptors and materials have
    /// no page of their own — filter `search_catalogue` instead.
    pub kind: EntityKind,
    /// Slug from `list_catalogue_entities`.
    pub slug: String,
}

#[derive(Debug, Deserialize, Serialize, JsonSchema)]
pub struct ListOwned {
    /// Include pieces the owner archived (sold, traded, lost…). Default false.
    pub include_archived: Option<bool>,
    /// Filter on one appearance tag.
    pub tag: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

#[derive(Debug, Deserialize, Serialize, JsonSchema)]
pub struct OwnedItemId {
    pub owned_item_id: uuid::Uuid,
}

#[derive(Debug, Deserialize, Serialize, JsonSchema)]
pub struct Paging {
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

#[derive(Debug, Deserialize, Serialize, JsonSchema)]
pub struct ListPreorders {
    /// Only pre-orders not yet received or cancelled. Default false.
    pub open_only: Option<bool>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

#[derive(Debug, Deserialize, Serialize, JsonSchema)]
pub struct PreorderId {
    pub preorder_id: uuid::Uuid,
}

#[derive(Debug, Deserialize, Serialize, JsonSchema)]
pub struct YearInReview {
    /// Calendar year, 1990–2100.
    pub year: i32,
}

#[derive(Debug, Deserialize, Serialize, JsonSchema)]
pub struct ListNotifications {
    pub unread_only: Option<bool>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

/// Whose market-price history to return.
#[derive(Debug, Clone, Copy, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum PriceHistoryScope {
    /// Figures the caller owns.
    Owned,
    /// Figures on the caller's wishlist.
    Wished,
}

#[derive(Debug, Deserialize, Serialize, JsonSchema)]
pub struct PriceHistory {
    pub scope: PriceHistoryScope,
}

#[derive(Debug, Deserialize, Serialize, JsonSchema)]
pub struct LandedCost {
    /// Goods value, in `currency`.
    pub goods: f64,
    /// Shipping paid, in the same `currency`. Default 0.
    pub shipping: Option<f64>,
    /// ISO-4217 code of `goods` and `shipping`. No conversion is performed —
    /// mixing FX into a tax estimate would hide which number is uncertain.
    pub currency: String,
    /// ISO-3166 alpha-2 destination. An unknown one yields no estimate rather
    /// than a guess.
    pub destination: String,
    /// Carrier slug, from `get_landed_cost_rules`. Unknown → no handling fee.
    pub carrier: Option<String>,
    /// Number of items in the consignment; some duties are charged per item.
    /// Default 1.
    pub items: Option<u32>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn limits_are_clamped_into_range() {
        assert_eq!(clamp_limit(None), DEFAULT_LIMIT);
        assert_eq!(clamp_limit(Some(0)), 1);
        assert_eq!(clamp_limit(Some(-5)), 1);
        assert_eq!(clamp_limit(Some(10_000)), MAX_LIMIT);
        assert_eq!(clamp_offset(Some(-1)), 0);
    }

    #[test]
    fn page_reports_the_full_total_not_the_slice() {
        let page = Page::of((0..120).collect::<Vec<i32>>(), 50, 0);
        assert_eq!(page.items.len(), 50);
        assert_eq!(page.total, 120);
        assert!(page.has_more);

        let last = Page::of((0..120).collect::<Vec<i32>>(), 50, 100);
        assert_eq!(last.items, (100..120).collect::<Vec<i32>>());
        assert!(!last.has_more);
    }

    #[test]
    fn an_offset_past_the_end_is_an_empty_page_not_a_panic() {
        let page = Page::of(vec![1, 2, 3], 50, 99);
        assert!(page.items.is_empty());
        assert_eq!(page.total, 3);
        assert!(!page.has_more);
    }
}

// ------------------------------------------------------------ write inputs
//
// Money and dates travel as strings, not `f64`/`Decimal`/`NaiveDate`.
//
// For money that's a correctness point, not a style one: a JSON number is an
// IEEE-754 double, and `1299.10` doesn't survive the round trip intact. The
// API already returns amounts as strings for the same reason, so this also
// keeps what an agent reads and what it writes in the same shape.
//
// For dates it buys a better failure: a malformed string comes back as a
// tool-level "expected YYYY-MM-DD" the model can fix, rather than a schema
// rejection whose message the client renders opaquely.

use crate::error::{AppError, AppResult};
use rust_decimal::Decimal;
use std::str::FromStr as _;

/// Parse a money amount. `None` stays `None` (field omitted).
///
/// Negatives are refused here rather than downstream: the domain validates
/// currencies and enums but not sign, and nothing this endpoint writes — a
/// price, a shipping cost, a deposit, a valuation — is ever meaningfully
/// negative. Catching it at the boundary turns a nonsense row into a message
/// the model can act on.
pub fn money(value: &Option<String>) -> AppResult<Option<Decimal>> {
    match value {
        None => Ok(None),
        Some(raw) => {
            let parsed = Decimal::from_str(raw.trim()).map_err(|_| {
                AppError::BadRequest("amounts must be decimal strings, e.g. \"1299.00\"")
            })?;
            if parsed.is_sign_negative() && !parsed.is_zero() {
                return Err(AppError::BadRequest("amounts cannot be negative"));
            }
            Ok(Some(parsed))
        }
    }
}

/// Parse an ISO date. `None` stays `None` (field omitted).
pub fn date(value: &Option<String>) -> AppResult<Option<chrono::NaiveDate>> {
    match value {
        None => Ok(None),
        Some(raw) => chrono::NaiveDate::parse_from_str(raw.trim(), "%Y-%m-%d")
            .map(Some)
            .map_err(|_| AppError::BadRequest("dates must be YYYY-MM-DD")),
    }
}

#[derive(Debug, Deserialize, Serialize, JsonSchema)]
pub struct AddOwnedItem {
    /// Catalogue figure this piece is a copy of. Resolve it first with
    /// `find_figure_by_barcode` or `search_catalogue`.
    pub figure_id: uuid::Uuid,
    /// One of: mib_sealed, opened_box, displayed, loose, damaged.
    /// Defaults to mib_sealed.
    pub condition: Option<String>,
    /// Price paid, as a decimal string (e.g. "1150.00").
    pub price_amount: Option<String>,
    /// ISO-4217 code for `price_amount` and `shipping_amount`.
    pub price_currency: Option<String>,
    pub shipping_amount: Option<String>,
    /// Free-text shop name. A name not already on file creates a new shop
    /// record, so prefer one that appears in `list_owned_items`.
    pub store: Option<String>,
    /// YYYY-MM-DD.
    pub purchase_date: Option<String>,
    /// Display cabinet / storage location.
    pub location: Option<String>,
    /// Max 4096 characters.
    pub notes: Option<String>,
    /// One of: purchased, gift, trade, found, inherited, other.
    pub acquisition_source: Option<String>,
    /// Who it came from, when not a shop.
    pub acquired_from: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, JsonSchema)]
pub struct UpdateOwnedItem {
    pub owned_item_id: uuid::Uuid,
    /// Omitted fields are left untouched.
    pub condition: Option<String>,
    pub price_amount: Option<String>,
    pub price_currency: Option<String>,
    pub shipping_amount: Option<String>,
    pub store: Option<String>,
    pub purchase_date: Option<String>,
    pub location: Option<String>,
    pub notes: Option<String>,
    pub acquisition_source: Option<String>,
    pub acquired_from: Option<String>,
    /// Item grade: A+, A, A-, B+, B, C or J. Describes the figure itself.
    pub condition_item: Option<String>,
    /// Box grade, same scale.
    pub condition_box: Option<String>,
    /// One of: complete, missing_parts, box_only, no_box.
    pub completeness: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, JsonSchema)]
pub struct ArchiveOwnedItem {
    pub owned_item_id: uuid::Uuid,
    /// One of: sold, traded, lost, gifted, other.
    pub reason: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, JsonSchema)]
pub struct SetOwnedValue {
    pub owned_item_id: uuid::Uuid,
    /// Current market value as a decimal string. Omit to clear the manual
    /// valuation and fall back to the catalogue MSRP.
    pub amount: Option<String>,
    pub currency: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, JsonSchema)]
pub struct AddWishlistItem {
    pub figure_id: uuid::Uuid,
    /// The most the owner is willing to pay, as a decimal string.
    pub max_price_amount: Option<String>,
    pub max_price_currency: Option<String>,
    pub note: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, JsonSchema)]
pub struct UpdateWishlistItem {
    pub figure_id: uuid::Uuid,
    pub max_price_amount: Option<String>,
    pub max_price_currency: Option<String>,
    pub note: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, JsonSchema)]
pub struct AddPreorder {
    pub figure_id: uuid::Uuid,
    /// One of: announced, preorder_open, preordered, in_production, released,
    /// shipped, received, cancelled. Defaults to preordered.
    pub status: Option<String>,
    pub store: Option<String>,
    /// The shop's own order reference.
    pub order_ref: Option<String>,
    pub tracking_url: Option<String>,
    /// Expected release, YYYY-MM-DD.
    pub release_date: Option<String>,
    pub price_amount: Option<String>,
    pub price_currency: Option<String>,
    /// Deposit paid, in `price_currency`.
    pub deposit_amount: Option<String>,
    pub estimated_delivery_days: Option<i32>,
    pub notes: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, JsonSchema)]
pub struct UpdatePreorder {
    pub preorder_id: uuid::Uuid,
    pub status: Option<String>,
    pub store: Option<String>,
    pub order_ref: Option<String>,
    pub tracking_url: Option<String>,
    /// A new expected release date. Changing it records a slip in the
    /// pre-order's date history.
    pub release_date: Option<String>,
    /// Why the date moved — kept on the history entry.
    pub release_date_note: Option<String>,
    pub price_amount: Option<String>,
    pub price_currency: Option<String>,
    pub deposit_amount: Option<String>,
    pub estimated_delivery_days: Option<i32>,
    pub notes: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, JsonSchema)]
pub struct CreateFigure {
    /// Max 256 characters.
    pub name: String,
    /// Figure-type id from `list_catalogue_facets`.
    pub figure_type: String,
    pub manufacturer_name: Option<String>,
    pub sculptor_name: Option<String>,
    pub series_name: Option<String>,
    pub character_name: Option<String>,
    /// e.g. "1/7", "1/4".
    pub scale: Option<String>,
    pub height_mm: Option<i32>,
    pub materials: Option<Vec<String>>,
    /// YYYY-MM-DD.
    pub release_date: Option<String>,
    /// Recommended retail price, as a decimal string.
    pub msrp_amount: Option<String>,
    pub msrp_currency: Option<String>,
    /// JAN / EAN barcode. Worth including — it's what stops a later duplicate.
    pub jan: Option<String>,
    pub exclusivity: Option<String>,
    pub edition: Option<String>,
    pub version_name: Option<String>,
    pub description: Option<String>,
    /// Mark explicit figures so other users' hide/blur preferences apply.
    pub is_nsfw: Option<bool>,
}

#[derive(Debug, Deserialize, Serialize, JsonSchema)]
pub struct UpdateFigure {
    pub figure_id: uuid::Uuid,
    /// Omitted fields are left untouched.
    pub name: Option<String>,
    pub figure_type: Option<String>,
    pub manufacturer_name: Option<String>,
    pub sculptor_name: Option<String>,
    pub series_name: Option<String>,
    pub character_name: Option<String>,
    pub scale: Option<String>,
    pub height_mm: Option<i32>,
    pub materials: Option<Vec<String>>,
    pub release_date: Option<String>,
    pub msrp_amount: Option<String>,
    pub msrp_currency: Option<String>,
    pub jan: Option<String>,
    pub exclusivity: Option<String>,
    pub edition: Option<String>,
    pub version_name: Option<String>,
    pub description: Option<String>,
    pub is_nsfw: Option<bool>,
}

/// Shared shape for the destructive tools: the id, plus an explicit
/// acknowledgement.
///
/// `confirm` is not ceremony. These tools erase rows and their stored photo
/// and scan objects with no undo, so the schema makes the model state the
/// intent in the same call — a plan that drifted into a deletion has to say so
/// out loud, where a human reviewing the tool call can see it.
#[derive(Debug, Deserialize, Serialize, JsonSchema)]
pub struct ConfirmedDelete {
    pub id: uuid::Uuid,
    /// Must be `true`. Anything else is refused.
    pub confirm: bool,
}

#[derive(Debug, Deserialize, Serialize, JsonSchema)]
pub struct SearchCollectors {
    /// Name fragment. Omitted or empty lists the public collectors.
    pub q: Option<String>,
}

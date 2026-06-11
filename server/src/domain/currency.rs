//! Single source of truth for the currencies FigureCollector supports.
//!
//! Every money write-path (figure MSRP, owned price + value, wishlist target,
//! preorder price + deposit) validates against [`is_supported`], the user's
//! `preferred_currency` is checked against it, and `GET /api/currencies` hands
//! the same list to the SPA — so the set of selectable currencies is defined
//! here and nowhere else. ECB (frankfurter) covers all of these, so every one
//! is convertible for the display-currency feature.

/// Supported ISO 4217 currency codes, in the UI's preferred order.
pub const SUPPORTED: &[&str] = &["EUR", "USD", "JPY", "GBP", "CHF", "CAD"];

/// True iff `code` is a supported currency code. Exact match — callers pass the
/// already-upper-cased code the client sends; lower-case / junk (`btc`, `XXX`)
/// is rejected, which keeps un-convertible amounts out of the data.
pub fn is_supported(code: &str) -> bool {
    SUPPORTED.contains(&code)
}

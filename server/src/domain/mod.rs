//! Figurine domain — catalog + per-user records.
//!
//! Phase 2 Foundation: manual CRUD for figures and owned items, plus pre-orders
//! with date-slip history. Photo uploads, MFC scraping, and AniList enrichment
//! ship in Phase 2B.

pub mod activity;
pub mod figure;
pub mod owned;
pub mod photo;
pub mod preorder;
pub mod scan;

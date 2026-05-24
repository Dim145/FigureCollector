//! External metadata providers.
//!
//! Phase 2C ships:
//!   - `anilist` — GraphQL client for AniList (fully working)
//!   - `mfc`     — HTML parser skeleton for MyFigureCollection (parser is
//!                 ready; the direct HTTP fetcher is gated behind Cloudflare
//!                 anti-bot, so today it raises a `FeatureDisabled`. When a
//!                 proxy comes back online — Tenji.moe is currently 500ing —
//!                 swap the fetcher in `mfc::fetch_item_html`.
//!
//! Both providers share `cache` (Postgres-backed, TTL'd) so we never hammer
//! the upstream for the same resource twice in a row.

pub mod anilist;
pub mod cache;
pub mod mfc;

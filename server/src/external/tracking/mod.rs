//! Live shipping-status proxy.
//!
//! `GET /api/tracking/{carrier}/{number}` lands here. We can't fetch the
//! carrier APIs directly from the browser (CORS + API keys), so the SPA
//! hits this proxy and we make the upstream call server-side with a key
//! pulled from env. The response is normalised into [`TrackingStatus`] so
//! the SPA renders a single shape regardless of carrier.
//!
//! Caching strategy: result lands in `external_lookups` under
//! `(provider="tracking", resource="{carrier}", key="{number}")`. TTL is
//! 15 min for in-transit shipments and 24h once delivered (delivered
//! status doesn't change). Every miss makes exactly one upstream call.
//!
//! Carriers currently wired:
//!   - Colissimo / La Poste (single Okapi key)   — `colissimo` submodule
//!   - DHL Express          (single DHL-API-Key) — `dhl` submodule
//!   - UPS                  (OAuth2 → bearer)    — `ups` submodule
//!
//! Adding a carrier = one new submodule + one match arm in [`fetch`].

use crate::config::TrackingConfig;
use crate::error::{AppError, AppResult};
use crate::external::cache;
use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;

mod colissimo;
mod dhl;
mod ups;

const PROVIDER: &str = "tracking";
/// Wall-clock cap for any single upstream call. Shared by every carrier
/// client so a slow carrier can't pin the connection pool open.
pub(super) const FETCH_TIMEOUT_SECS: u64 = 20;
/// Refresh in-transit shipments every 15 minutes — fast enough for the
/// "delivered today!" moment, slow enough to avoid hammering carriers.
const TTL_IN_TRANSIT: i64 = 15 * 60;
/// Delivered or terminal-cancelled shipments don't change.
const TTL_DELIVERED_SECS: i64 = 24 * 60 * 60;

// =============================================================================
// Public response shape — what the SPA consumes
// =============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrackingStatus {
    /// Carrier id matching the one in the URL ("colissimo", "dhl", "ups").
    pub carrier: String,
    /// Tracking number we queried (echoed back, trimmed).
    pub number: String,
    /// Best-effort one-line status pulled from the most recent event.
    pub status: String,
    /// Carrier-native status code when surfaced (e.g. DHL `"delivered"`,
    /// Colissimo `"DR1"`). May be `None` for carriers that don't expose one.
    pub status_code: Option<String>,
    /// When that status was recorded.
    pub timestamp: Option<DateTime<Utc>>,
    /// City / depot / country where the event happened, when given.
    pub location: Option<String>,
    /// `true` when the latest event is a delivery / final state.
    pub is_delivered: bool,
    /// Chronological event list, most recent first.
    pub events: Vec<TrackingEvent>,
    /// When we last fetched from the carrier — surfaced so the UI can show
    /// "refreshed N minutes ago".
    pub fetched_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrackingEvent {
    pub timestamp: Option<DateTime<Utc>>,
    pub description: String,
    pub location: Option<String>,
}

// =============================================================================
// Dispatch
// =============================================================================

/// Top-level entry — picks the right carrier client, runs the cache check.
pub async fn fetch(
    pool: &PgPool,
    http: &reqwest::Client,
    config: &TrackingConfig,
    carrier: &str,
    number: &str,
) -> AppResult<TrackingStatus> {
    let number = number.trim();
    if number.is_empty() {
        return Err(AppError::BadRequest("tracking number is required"));
    }
    if number.len() > 64 {
        return Err(AppError::BadRequest("tracking number too long"));
    }

    let carrier = carrier.to_lowercase();

    // Cache lookup — but with carrier-specific TTL we can't lean on the
    // generic `cached_fetch` helper (it stores TTL on write, not on read).
    // Instead: look up directly, decide based on stored `is_delivered`.
    if let Some(cached) = cache::get::<TrackingStatus>(pool, PROVIDER, &carrier, number).await? {
        // Hand back the cached value as long as it's still considered fresh
        // by its own TTL. `cache::get` already discards expired rows.
        return Ok(cached);
    }

    let fresh = match carrier.as_str() {
        "colissimo" => colissimo::fetch(http, config, number).await?,
        "dhl" => dhl::fetch(http, config, number).await?,
        "ups" => ups::fetch(http, config, number).await?,
        _ => {
            return Err(AppError::BadRequest(
                "unsupported carrier (try: colissimo, dhl, ups)",
            ));
        }
    };

    let ttl = if fresh.is_delivered {
        Duration::seconds(TTL_DELIVERED_SECS)
    } else {
        Duration::seconds(TTL_IN_TRANSIT)
    };
    cache::put(pool, PROVIDER, &carrier, number, &fresh, ttl).await?;
    Ok(fresh)
}

// =============================================================================
// Helpers — shared by every carrier submodule
// =============================================================================

/// Best-effort percent encoding for path segments. Tracking numbers are
/// always ASCII alphanumeric in practice but be defensive.
pub(super) fn urlencoding(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            'A'..='Z' | 'a'..='z' | '0'..='9' | '-' | '_' | '.' | '~' => out.push(c),
            _ => {
                let mut buf = [0u8; 4];
                for byte in c.encode_utf8(&mut buf).bytes() {
                    out.push_str(&format!("%{:02X}", byte));
                }
            }
        }
    }
    out
}

/// Parse an ISO-8601 timestamp lenient enough to swallow both DHL's
/// `"2025-05-23T08:15:00"` (no offset) and Colissimo's
/// `"2025-05-23T10:30:00+02:00"`.
pub(super) fn parse_iso8601(s: &str) -> Option<DateTime<Utc>> {
    let s = s.trim();
    if let Ok(dt) = DateTime::parse_from_rfc3339(s) {
        return Some(dt.with_timezone(&Utc));
    }
    // Tolerate "YYYY-MM-DDThh:mm:ss" (no offset → treat as UTC)
    if let Ok(naive) = chrono::NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M:%S") {
        return Some(DateTime::<Utc>::from_naive_utc_and_offset(naive, Utc));
    }
    if let Ok(naive) = chrono::NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M:%S") {
        return Some(DateTime::<Utc>::from_naive_utc_and_offset(naive, Utc));
    }
    None
}

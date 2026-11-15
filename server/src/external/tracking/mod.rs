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
//! Upstreams, in order of preference (see [`provider_for`]):
//!   - the carrier's own free API when its key is set —
//!       Colissimo / La Poste (Okapi key)  — `colissimo` submodule
//!       DHL Express (DHL-API-Key)         — `dhl` submodule
//!       UPS (OAuth2 → bearer)             — `ups` submodule
//!   - otherwise Parcels (`PARCELS_API_KEY`), a paid aggregator covering
//!     every other carrier and bare numbers — `parcels` submodule.
//!
//! Adding an official carrier = one new submodule + one [`Provider`] arm.

use crate::config::TrackingConfig;
use crate::error::{AppError, AppResult};
use crate::external::cache;
use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;

mod colissimo;
mod dhl;
mod parcels;
pub mod parse;
mod ups;

const PROVIDER: &str = "tracking";
/// Cache slot holding the `request_id` of a Parcels lookup still running, so
/// the next call resumes it instead of starting a new one. Outlives the
/// ~30-min retention of the request on Parcels' side only marginally.
const PENDING_PROVIDER: &str = "tracking-pending";
const PENDING_TTL_SECS: i64 = 25 * 60;
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
    /// Carrier display name when the upstream detected it (Parcels' auto
    /// detection) — names the carrier of a bare tracking number.
    #[serde(default)]
    pub carrier_name: Option<String>,
    /// Which upstream answered: "colissimo" | "dhl" | "ups" | "parcels".
    #[serde(default)]
    pub provider: Option<String>,
    /// `true` while Parcels is still querying the carrier: no status yet, ask
    /// again in a few seconds. Never cached.
    #[serde(default)]
    pub pending: bool,
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

/// The upstream that serves a carrier on this server.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Provider {
    Colissimo,
    Dhl,
    Ups,
    Parcels,
}

impl Provider {
    fn id(self) -> &'static str {
        match self {
            Provider::Colissimo => "colissimo",
            Provider::Dhl => "dhl",
            Provider::Ups => "ups",
            Provider::Parcels => "parcels",
        }
    }
}

/// Which upstream serves `carrier`: its own free API when the key is set,
/// else Parcels when configured, else none (the SPA shows a plain link).
pub fn provider_for(config: &TrackingConfig, carrier: &str) -> Option<Provider> {
    let official = match carrier {
        "colissimo" if config.colissimo_key.is_some() => Some(Provider::Colissimo),
        "dhl" if config.dhl_key.is_some() => Some(Provider::Dhl),
        "ups" if config.ups_client_id.is_some() && config.ups_client_secret.is_some() => {
            Some(Provider::Ups)
        }
        _ => None,
    };
    official.or_else(|| {
        (config.parcels_key.is_some() && parse::is_known_carrier(carrier))
            .then_some(Provider::Parcels)
    })
}

/// Carrier ids with a live source on this server (`GET /tracking/providers`).
pub fn live_carriers(config: &TrackingConfig) -> Vec<&'static str> {
    parse::carrier_ids()
        .filter(|c| provider_for(config, c).is_some())
        .collect()
}

/// Whether any carrier can be tracked live at all.
pub fn any_provider(config: &TrackingConfig) -> bool {
    parse::carrier_ids().any(|c| provider_for(config, c).is_some())
}

/// Top-level entry — picks the upstream, runs the cache check.
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
    if !parse::is_known_carrier(&carrier) {
        return Err(AppError::BadRequest("unsupported carrier"));
    }
    let provider = provider_for(config, &carrier).ok_or(AppError::FeatureDisabled(
        "no live-tracking source configured for this carrier",
    ))?;

    // Cache lookup — but with carrier-specific TTL we can't lean on the
    // generic `cached_fetch` helper (it stores TTL on write, not on read).
    // Instead: look up directly, decide based on stored `is_delivered`.
    if let Some(cached) = cache::get::<TrackingStatus>(pool, PROVIDER, &carrier, number).await? {
        // Hand back the cached value as long as it's still considered fresh
        // by its own TTL. `cache::get` already discards expired rows.
        return Ok(cached);
    }

    let mut fresh = match provider {
        Provider::Colissimo => colissimo::fetch(http, config, number).await?,
        Provider::Dhl => dhl::fetch(http, config, number).await?,
        Provider::Ups => ups::fetch(http, config, number).await?,
        Provider::Parcels => match fetch_parcels(pool, http, config, &carrier, number).await? {
            Some(status) => status,
            None => return Ok(pending_status(&carrier, number)),
        },
    };
    fresh.provider = Some(provider.id().to_string());

    let ttl = if fresh.is_delivered {
        Duration::seconds(TTL_DELIVERED_SECS)
    } else {
        Duration::seconds(TTL_IN_TRANSIT)
    };
    cache::put(pool, PROVIDER, &carrier, number, &fresh, ttl).await?;
    Ok(fresh)
}

/// A Parcels lookup, resuming the parked one when a previous call left it
/// running. `None` = still running (its id is parked for the next call).
async fn fetch_parcels(
    pool: &PgPool,
    http: &reqwest::Client,
    config: &TrackingConfig,
    carrier: &str,
    number: &str,
) -> AppResult<Option<TrackingStatus>> {
    let parked = cache::get::<String>(pool, PENDING_PROVIDER, carrier, number).await?;
    let resumed = match parked {
        Some(request_id) => parcels::poll(http, config, carrier, number, &request_id).await?,
        None => None,
    };
    let outcome = match resumed {
        Some(outcome) => outcome,
        None => parcels::create(http, config, carrier, number).await?,
    };
    match outcome {
        parcels::Outcome::Done(status) => {
            cache::invalidate(pool, PENDING_PROVIDER, carrier, number).await?;
            Ok(Some(status))
        }
        parcels::Outcome::Pending { request_id } => {
            cache::put(
                pool,
                PENDING_PROVIDER,
                carrier,
                number,
                &request_id,
                Duration::seconds(PENDING_TTL_SECS),
            )
            .await?;
            Ok(None)
        }
    }
}

fn pending_status(carrier: &str, number: &str) -> TrackingStatus {
    TrackingStatus {
        carrier: carrier.to_string(),
        number: number.to_string(),
        status: String::new(),
        status_code: None,
        timestamp: None,
        location: None,
        is_delivered: false,
        events: Vec::new(),
        fetched_at: Utc::now(),
        carrier_name: None,
        provider: Some(Provider::Parcels.id().to_string()),
        pending: true,
    }
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

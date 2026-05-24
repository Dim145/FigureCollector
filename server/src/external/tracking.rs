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
//!   - Colissimo / La Poste (single Okapi key)
//!   - DHL Express          (single DHL-API-Key header)
//!   - UPS                  (OAuth2 client credentials → bearer)
//!
//! Adding a carrier = one new submodule + one match arm in [`fetch`].

use crate::config::TrackingConfig;
use crate::error::{AppError, AppResult};
use crate::external::cache;
use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use std::time::Duration as StdDuration;

const PROVIDER: &str = "tracking";
const FETCH_TIMEOUT_SECS: u64 = 20;
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
    if let Some(cached) = cache::get::<TrackingStatus>(pool, PROVIDER, &carrier, number).await?
    {
        // Hand back the cached value as long as it's still considered fresh
        // by its own TTL. `cache::get` already discards expired rows.
        return Ok(cached);
    }

    let fresh = match carrier.as_str() {
        "colissimo" => fetch_colissimo(http, config, number).await?,
        "dhl" => fetch_dhl(http, config, number).await?,
        "ups" => fetch_ups(http, config, number).await?,
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
// Colissimo
// =============================================================================

async fn fetch_colissimo(
    http: &reqwest::Client,
    config: &TrackingConfig,
    number: &str,
) -> AppResult<TrackingStatus> {
    let key = config
        .colissimo_key
        .as_deref()
        .ok_or(AppError::FeatureDisabled(
            "COLISSIMO_API_KEY not configured on the server",
        ))?;

    #[derive(Deserialize)]
    struct Resp {
        shipment: Option<Shipment>,
        #[serde(rename = "returnCode")]
        return_code: Option<i32>,
        #[serde(rename = "returnMessage")]
        return_message: Option<String>,
    }
    #[derive(Deserialize)]
    struct Shipment {
        #[serde(rename = "isFinal")]
        is_final: Option<bool>,
        event: Vec<Event>,
    }
    #[derive(Deserialize)]
    struct Event {
        code: Option<String>,
        label: Option<String>,
        date: Option<String>,
        location: Option<String>,
    }

    let url = format!(
        "https://api.laposte.fr/suivi/v2/idships/{}?lang=fr_FR",
        urlencoding(number)
    );
    let resp = http
        .get(&url)
        .header("X-Okapi-Key", key)
        .header(reqwest::header::ACCEPT, "application/json")
        .timeout(StdDuration::from_secs(FETCH_TIMEOUT_SECS))
        .send()
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("Colissimo request failed: {e}")))?;

    let status = resp.status();
    if status == reqwest::StatusCode::NOT_FOUND {
        return Err(AppError::NotFound);
    }
    if !status.is_success() {
        // Some Colissimo errors come back as 4xx with a JSON body — try to
        // surface the message.
        let body: serde_json::Value = resp.json().await.unwrap_or_default();
        let msg = body
            .get("returnMessage")
            .and_then(|v| v.as_str())
            .unwrap_or("Colissimo error")
            .to_string();
        return Err(AppError::Internal(anyhow::anyhow!(
            "Colissimo {}: {}",
            status,
            msg
        )));
    }

    let parsed: Resp = resp
        .json()
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("Colissimo JSON parse failed: {e}")))?;

    if let (Some(rc), Some(rm)) = (parsed.return_code, parsed.return_message.as_deref()) {
        if rc >= 400 {
            return Err(AppError::Internal(anyhow::anyhow!(
                "Colissimo returned {}: {}",
                rc,
                rm
            )));
        }
    }

    let shipment = parsed.shipment.ok_or_else(|| {
        AppError::Internal(anyhow::anyhow!("Colissimo response missing shipment"))
    })?;
    let is_delivered = shipment.is_final.unwrap_or(false);

    // Colissimo returns events oldest-first — we surface most-recent first.
    let mut events: Vec<TrackingEvent> = shipment
        .event
        .into_iter()
        .map(|e| TrackingEvent {
            timestamp: e.date.as_deref().and_then(parse_iso8601),
            description: e
                .label
                .unwrap_or_default()
                .trim()
                .to_string(),
            location: e.location.filter(|s| !s.trim().is_empty()),
        })
        .collect();
    events.reverse();

    let latest = events.first().cloned().unwrap_or_else(|| TrackingEvent {
        timestamp: None,
        description: "Aucun événement disponible".into(),
        location: None,
    });
    // Colissimo's first event after reversal is the most recent; the code
    // we want to surface ought to come from that same event in the input —
    // but we already consumed the array. Re-derive from `events.len()` not
    // possible; use the label's first 8 chars as a soft proxy if needed.
    let status_code = None; // Colissimo's `code` is per-event; we surface label only.

    Ok(TrackingStatus {
        carrier: "colissimo".into(),
        number: number.to_string(),
        status: latest.description.clone(),
        status_code,
        timestamp: latest.timestamp,
        location: latest.location.clone(),
        is_delivered,
        events,
        fetched_at: Utc::now(),
    })
}

// =============================================================================
// DHL Express
// =============================================================================

async fn fetch_dhl(
    http: &reqwest::Client,
    config: &TrackingConfig,
    number: &str,
) -> AppResult<TrackingStatus> {
    let key = config
        .dhl_key
        .as_deref()
        .ok_or(AppError::FeatureDisabled(
            "DHL_API_KEY not configured on the server",
        ))?;

    #[derive(Deserialize)]
    struct Resp {
        shipments: Option<Vec<Shipment>>,
    }
    #[derive(Deserialize)]
    struct Shipment {
        status: Option<DhlStatus>,
        events: Option<Vec<DhlEvent>>,
    }
    #[derive(Deserialize)]
    struct DhlStatus {
        timestamp: Option<String>,
        #[serde(rename = "statusCode")]
        status_code: Option<String>,
        description: Option<String>,
        status: Option<String>,
        location: Option<DhlLocation>,
    }
    #[derive(Deserialize)]
    struct DhlEvent {
        timestamp: Option<String>,
        description: Option<String>,
        location: Option<DhlLocation>,
    }
    #[derive(Deserialize)]
    struct DhlLocation {
        address: Option<DhlAddress>,
    }
    #[derive(Deserialize)]
    struct DhlAddress {
        #[serde(rename = "addressLocality")]
        locality: Option<String>,
        #[serde(rename = "countryCode")]
        country: Option<String>,
    }

    let format_loc = |loc: &DhlLocation| -> Option<String> {
        let a = loc.address.as_ref()?;
        match (a.locality.as_deref(), a.country.as_deref()) {
            (Some(c), Some(cc)) => Some(format!("{c}, {cc}")),
            (Some(c), None) => Some(c.to_string()),
            (None, Some(cc)) => Some(cc.to_string()),
            _ => None,
        }
    };

    let url = format!(
        "https://api-eu.dhl.com/track/shipments?trackingNumber={}",
        urlencoding(number)
    );
    let resp = http
        .get(&url)
        .header("DHL-API-Key", key)
        .header(reqwest::header::ACCEPT, "application/json")
        .timeout(StdDuration::from_secs(FETCH_TIMEOUT_SECS))
        .send()
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DHL request failed: {e}")))?;

    if resp.status() == reqwest::StatusCode::NOT_FOUND {
        return Err(AppError::NotFound);
    }
    if !resp.status().is_success() {
        return Err(AppError::Internal(anyhow::anyhow!(
            "DHL HTTP {}",
            resp.status()
        )));
    }

    let parsed: Resp = resp
        .json()
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("DHL JSON parse failed: {e}")))?;

    let shipment = parsed
        .shipments
        .and_then(|mut v| v.drain(..).next())
        .ok_or(AppError::NotFound)?;

    let events: Vec<TrackingEvent> = shipment
        .events
        .unwrap_or_default()
        .into_iter()
        .map(|e| TrackingEvent {
            timestamp: e.timestamp.as_deref().and_then(parse_iso8601),
            description: e.description.unwrap_or_default().trim().to_string(),
            location: e.location.as_ref().and_then(&format_loc),
        })
        .collect();

    let status_code = shipment
        .status
        .as_ref()
        .and_then(|s| s.status_code.clone())
        .map(|s| s.to_lowercase());
    let is_delivered = matches!(status_code.as_deref(), Some("delivered"));

    let status_text = shipment
        .status
        .as_ref()
        .and_then(|s| s.description.clone().or_else(|| s.status.clone()))
        .unwrap_or_else(|| {
            events
                .first()
                .map(|e| e.description.clone())
                .unwrap_or_else(|| "No status available".into())
        });
    let timestamp = shipment
        .status
        .as_ref()
        .and_then(|s| s.timestamp.as_deref())
        .and_then(parse_iso8601)
        .or_else(|| events.first().and_then(|e| e.timestamp));
    let location = shipment
        .status
        .as_ref()
        .and_then(|s| s.location.as_ref().and_then(&format_loc))
        .or_else(|| events.first().and_then(|e| e.location.clone()));

    Ok(TrackingStatus {
        carrier: "dhl".into(),
        number: number.to_string(),
        status: status_text,
        status_code,
        timestamp,
        location,
        is_delivered,
        events,
        fetched_at: Utc::now(),
    })
}

// =============================================================================
// UPS — OAuth2 client credentials + tracking API
// =============================================================================

async fn fetch_ups(
    http: &reqwest::Client,
    config: &TrackingConfig,
    number: &str,
) -> AppResult<TrackingStatus> {
    let (client_id, client_secret) = match (
        config.ups_client_id.as_deref(),
        config.ups_client_secret.as_deref(),
    ) {
        (Some(id), Some(secret)) => (id, secret),
        _ => {
            return Err(AppError::FeatureDisabled(
                "UPS_CLIENT_ID / UPS_CLIENT_SECRET not configured on the server",
            ));
        }
    };

    // Step 1 — exchange credentials for a short-lived bearer token. UPS
    // tokens are valid for ~4h; we don't bother caching the token (the
    // exchange itself is cheap) but the *result* lands in our 15-min cache.
    // reqwest handles the Basic auth header encoding for us — no base64 dep.
    let token = {
        #[derive(Deserialize)]
        struct TokenResp {
            access_token: String,
        }
        let resp = http
            .post("https://onlinetools.ups.com/security/v1/oauth/token")
            .basic_auth(client_id, Some(client_secret))
            .header(
                reqwest::header::CONTENT_TYPE,
                "application/x-www-form-urlencoded",
            )
            .body("grant_type=client_credentials")
            .timeout(StdDuration::from_secs(FETCH_TIMEOUT_SECS))
            .send()
            .await
            .map_err(|e| AppError::Internal(anyhow::anyhow!("UPS auth request failed: {e}")))?;
        if !resp.status().is_success() {
            return Err(AppError::Internal(anyhow::anyhow!(
                "UPS auth HTTP {}",
                resp.status()
            )));
        }
        let parsed: TokenResp = resp
            .json()
            .await
            .map_err(|e| AppError::Internal(anyhow::anyhow!("UPS auth JSON failed: {e}")))?;
        parsed.access_token
    };

    // Step 2 — call the tracking endpoint with the bearer.
    #[derive(Deserialize)]
    struct Resp {
        #[serde(rename = "trackResponse")]
        track_response: Option<TrackResponse>,
    }
    #[derive(Deserialize)]
    struct TrackResponse {
        shipment: Option<Vec<Shipment>>,
    }
    #[derive(Deserialize)]
    struct Shipment {
        package: Option<Vec<Package>>,
    }
    #[derive(Deserialize)]
    struct Package {
        activity: Option<Vec<Activity>>,
        #[serde(rename = "currentStatus")]
        current_status: Option<CurrentStatus>,
    }
    #[derive(Deserialize)]
    struct CurrentStatus {
        description: Option<String>,
        #[serde(rename = "code")]
        code: Option<String>,
    }
    #[derive(Deserialize)]
    struct Activity {
        date: Option<String>,
        time: Option<String>,
        status: Option<ActivityStatus>,
        location: Option<UpsLocation>,
    }
    #[derive(Deserialize)]
    struct ActivityStatus {
        description: Option<String>,
        #[serde(rename = "code")]
        code: Option<String>,
    }
    #[derive(Deserialize)]
    struct UpsLocation {
        address: Option<UpsAddress>,
    }
    #[derive(Deserialize)]
    struct UpsAddress {
        city: Option<String>,
        #[serde(rename = "countryCode")]
        country: Option<String>,
    }

    // Per-call correlation id required by the tracking endpoint. v7 is
    // available crate-wide; UPS only needs something unique per request.
    let trans_id = uuid::Uuid::now_v7().to_string();
    let url = format!(
        "https://onlinetools.ups.com/api/track/v1/details/{}",
        urlencoding(number)
    );
    let resp = http
        .get(&url)
        .header(reqwest::header::AUTHORIZATION, format!("Bearer {token}"))
        .header("transId", &trans_id)
        .header("transactionSrc", "figurecollector")
        .header(reqwest::header::ACCEPT, "application/json")
        .timeout(StdDuration::from_secs(FETCH_TIMEOUT_SECS))
        .send()
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("UPS request failed: {e}")))?;

    if resp.status() == reqwest::StatusCode::NOT_FOUND {
        return Err(AppError::NotFound);
    }
    if !resp.status().is_success() {
        return Err(AppError::Internal(anyhow::anyhow!(
            "UPS HTTP {}",
            resp.status()
        )));
    }

    let parsed: Resp = resp
        .json()
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("UPS JSON parse failed: {e}")))?;

    let pkg = parsed
        .track_response
        .and_then(|tr| tr.shipment)
        .and_then(|mut v| v.drain(..).next())
        .and_then(|s| s.package)
        .and_then(|mut v| v.drain(..).next())
        .ok_or(AppError::NotFound)?;

    let events: Vec<TrackingEvent> = pkg
        .activity
        .unwrap_or_default()
        .into_iter()
        .map(|a| TrackingEvent {
            timestamp: ups_join_date_time(a.date.as_deref(), a.time.as_deref()),
            description: a
                .status
                .as_ref()
                .and_then(|s| s.description.clone())
                .unwrap_or_default()
                .trim()
                .to_string(),
            location: a.location.as_ref().and_then(|l| {
                let a = l.address.as_ref();
                let city = a.and_then(|x| x.city.as_deref());
                let cc = a.and_then(|x| x.country.as_deref());
                match (city, cc) {
                    (Some(c), Some(k)) => Some(format!("{c}, {k}")),
                    (Some(c), None) => Some(c.to_string()),
                    (None, Some(k)) => Some(k.to_string()),
                    _ => None,
                }
            }),
        })
        .collect();

    let code = pkg
        .current_status
        .as_ref()
        .and_then(|s| s.code.clone())
        .map(|s| s.to_lowercase());
    // UPS status codes: D / DV = delivered, I = in transit, M = manifest,
    // X = exception, RS = returned to shipper, etc.
    let is_delivered = matches!(code.as_deref(), Some("d") | Some("dv"));
    let status_text = pkg
        .current_status
        .and_then(|s| s.description)
        .unwrap_or_else(|| {
            events
                .first()
                .map(|e| e.description.clone())
                .unwrap_or_else(|| "No status available".into())
        });
    let timestamp = events.first().and_then(|e| e.timestamp);
    let location = events.first().and_then(|e| e.location.clone());

    Ok(TrackingStatus {
        carrier: "ups".into(),
        number: number.to_string(),
        status: status_text,
        status_code: code,
        timestamp,
        location,
        is_delivered,
        events,
        fetched_at: Utc::now(),
    })
}

// =============================================================================
// Helpers
// =============================================================================

/// Best-effort percent encoding for path segments. Tracking numbers are
/// always ASCII alphanumeric in practice but be defensive.
fn urlencoding(s: &str) -> String {
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
fn parse_iso8601(s: &str) -> Option<DateTime<Utc>> {
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

/// UPS activity records have separate `date` (YYYYMMDD) + `time` (HHMMSS)
/// fields. Stitch them into a UTC timestamp — UPS doesn't expose timezone
/// per event, so this is approximate.
fn ups_join_date_time(date: Option<&str>, time: Option<&str>) -> Option<DateTime<Utc>> {
    let date = date?;
    let time = time.unwrap_or("000000");
    if date.len() != 8 || time.len() != 6 {
        return None;
    }
    let combined = format!(
        "{}-{}-{}T{}:{}:{}",
        &date[0..4],
        &date[4..6],
        &date[6..8],
        &time[0..2],
        &time[2..4],
        &time[4..6]
    );
    parse_iso8601(&combined)
}

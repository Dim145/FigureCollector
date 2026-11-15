//! Parcels (parcelsapp.com) aggregator client — the fallback for every
//! carrier without its own key (Japan Post, Yamato, Sagawa, Chronopost,
//! Mondial Relay, …) and for bare numbers whose carrier we can't tell.
//!
//! The API is asynchronous. `POST /trackings` starts a lookup and returns a
//! `request_id`; it is often complete right away (`done: true`, served from
//! Parcels' own cache), otherwise `GET /trackings/{request_id}` is polled until
//! `done`. We poll briefly inline; if the carrier is still being queried after
//! that we hand back [`Outcome::Pending`] and the caller parks the request id
//! so the next call resumes it instead of starting over. A request record
//! lives ~30 min after its last update, then GET answers 404.
//!
//! Quota: Parcels bills each unique tracking number once per billing cycle.
//! Re-querying a number is free, so the 15-min refresh and the
//! delivered-parcel watcher cost nothing beyond the first lookup.
//!
//! Times (API v5): `states[].date` is the carrier-local scan time with no
//! zone, plus `utcOffset` when known. We convert to UTC when the offset is
//! given and otherwise take the local time as UTC (off by the carrier's zone,
//! at worst a few hours on a "3 days ago" display).

use super::{FETCH_TIMEOUT_SECS, TrackingEvent, TrackingStatus, urlencoding};
use crate::config::TrackingConfig;
use crate::error::{AppError, AppResult};
use chrono::{DateTime, FixedOffset, NaiveDateTime, TimeZone, Utc};
use serde::Deserialize;
use serde_json::json;
use std::time::Duration as StdDuration;

const DEFAULT_BASE_URL: &str = "https://parcelsapp.com/api/v5";
const DEFAULT_COUNTRY: &str = "FR";
const DEFAULT_LANGUAGE: &str = "en";
/// Inline poll schedule after a POST that isn't done yet (~10 s in all). Past
/// that the caller gets `Pending` and the SPA asks again a little later.
const POLL_DELAYS_MS: &[u64] = &[1_500, 2_000, 3_000, 3_500];

pub(super) enum Outcome {
    Done(TrackingStatus),
    Pending { request_id: String },
}

/// Parcels carrier slug for one of our carrier ids. With a hint Parcels skips
/// broad detection and needs no destination country. Ambiguous ids — DHL
/// (Express / eCommerce / Parcel), DPD (one slug per country), Amazon, and
/// bare numbers — get none and are auto-detected.
pub(super) fn carrier_hint(carrier: &str) -> Option<&'static str> {
    Some(match carrier {
        "ups" => "ups",
        "fedex" => "fedex",
        "usps" => "usps",
        "colissimo" => "la-poste",
        "chronopost" => "chronopost-france",
        "mondialrelay" => "mondial-relay",
        "gls" => "gls",
        "tnt" => "tnt",
        "japanpost" => "japan-post",
        "ems" => "ems",
        "yamato" => "yamato-japan",
        "sagawa" => "sagawa-jp",
        "hermes" => "myhermes-uk",
        _ => return None,
    })
}

fn base_url(config: &TrackingConfig) -> &str {
    config
        .parcels_api_url
        .as_deref()
        .unwrap_or(DEFAULT_BASE_URL)
}

fn api_key(config: &TrackingConfig) -> AppResult<&str> {
    config
        .parcels_key
        .as_deref()
        .ok_or(AppError::FeatureDisabled(
            "PARCELS_API_KEY not configured on the server",
        ))
}

/// Start a lookup and poll it briefly.
pub(super) async fn create(
    http: &reqwest::Client,
    config: &TrackingConfig,
    carrier: &str,
    number: &str,
) -> AppResult<Outcome> {
    let key = api_key(config)?;
    let mut item = json!({ "tracking_number": number });
    match carrier_hint(carrier) {
        Some(hint) => item["carrier_hint"] = json!(hint),
        None => {
            item["destination_country"] = json!(
                config
                    .parcels_destination_country
                    .as_deref()
                    .unwrap_or(DEFAULT_COUNTRY)
            )
        }
    }
    let body = json!({
        "language": config.parcels_language.as_deref().unwrap_or(DEFAULT_LANGUAGE),
        "shipments": [item],
    });

    let resp = http
        .post(format!("{}/trackings", base_url(config)))
        .bearer_auth(key)
        .header(reqwest::header::ACCEPT, "application/json")
        .json(&body)
        .timeout(StdDuration::from_secs(FETCH_TIMEOUT_SECS))
        .send()
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("Parcels request failed: {e}")))?;
    let mut outcome = interpret(read(resp).await?, carrier, number)?;

    for delay in POLL_DELAYS_MS {
        let Outcome::Pending { request_id } = &outcome else {
            break;
        };
        let request_id = request_id.clone();
        tokio::time::sleep(StdDuration::from_millis(*delay)).await;
        match poll(http, config, carrier, number, &request_id).await? {
            Some(next) => outcome = next,
            // Gone already — keep the pending id, the caller's next poll will
            // also see 404 and start a fresh lookup.
            None => break,
        }
    }
    Ok(outcome)
}

/// Read a parked lookup. `Ok(None)` when Parcels no longer knows the request
/// (expired) — the caller starts a fresh one.
pub(super) async fn poll(
    http: &reqwest::Client,
    config: &TrackingConfig,
    carrier: &str,
    number: &str,
    request_id: &str,
) -> AppResult<Option<Outcome>> {
    let key = api_key(config)?;
    let resp = http
        .get(format!(
            "{}/trackings/{}",
            base_url(config),
            urlencoding(request_id)
        ))
        .bearer_auth(key)
        .header(reqwest::header::ACCEPT, "application/json")
        .timeout(StdDuration::from_secs(FETCH_TIMEOUT_SECS))
        .send()
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("Parcels request failed: {e}")))?;
    if resp.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(None);
    }
    interpret(read(resp).await?, carrier, number).map(Some)
}

// =============================================================================
// Wire format
// =============================================================================

#[derive(Deserialize)]
struct TrackingResponse {
    request_id: Option<String>,
    #[serde(default)]
    done: bool,
    results: Option<Vec<ResultItem>>,
    rejected: Option<Vec<serde_json::Value>>,
}

#[derive(Deserialize)]
struct ResultItem {
    tracking_number: Option<String>,
    state: Option<String>,
    shipment: Option<Shipment>,
}

#[derive(Deserialize)]
struct Shipment {
    error: Option<String>,
    status: Option<String>,
    states: Option<Vec<State>>,
    #[serde(rename = "detectedCarrier")]
    detected_carrier: Option<CarrierRef>,
    services: Option<Vec<CarrierRef>>,
}

#[derive(Deserialize)]
struct State {
    state: Option<String>,
    location: Option<String>,
    date: Option<String>,
    #[serde(rename = "utcOffset")]
    utc_offset: Option<String>,
}

#[derive(Deserialize)]
struct CarrierRef {
    name: Option<String>,
}

#[derive(Deserialize)]
struct ErrorBody {
    error: Option<ErrorObject>,
}

#[derive(Deserialize)]
struct ErrorObject {
    code: Option<String>,
}

/// Map a Parcels HTTP response to its body, or to an error the SPA can
/// handle: "can't be tracked" stays a silent 404, account problems (bad key,
/// quota spent) and back-pressure are a 503 with the reason in the log.
async fn read(resp: reqwest::Response) -> AppResult<TrackingResponse> {
    let status = resp.status();
    if status.is_success() {
        return resp
            .json()
            .await
            .map_err(|e| AppError::Internal(anyhow::anyhow!("Parcels JSON parse failed: {e}")));
    }
    let code = resp
        .json::<ErrorBody>()
        .await
        .ok()
        .and_then(|b| b.error)
        .and_then(|e| e.code)
        .unwrap_or_default();
    tracing::warn!(%status, code = %code, "Parcels API error");
    Err(match (status.as_u16(), code.as_str()) {
        (400, "INVALID_TRACKING_NUMBER" | "DESTINATION_COUNTRY_REQUIRED") => AppError::NotFound,
        (401 | 403, _) => AppError::ServiceUnavailable("Parcels rejected the API key"),
        (402, _) => AppError::ServiceUnavailable("Parcels subscription limit reached"),
        (429 | 503, _) => AppError::ServiceUnavailable("Parcels is busy, try again later"),
        _ => AppError::Internal(anyhow::anyhow!("Parcels HTTP {status} {code}")),
    })
}

fn interpret(resp: TrackingResponse, carrier: &str, number: &str) -> AppResult<Outcome> {
    // One shipment per request: anything rejected is ours.
    if resp.rejected.as_ref().is_some_and(|r| !r.is_empty()) {
        return Err(AppError::NotFound);
    }
    let pending = || match resp.request_id.clone() {
        Some(request_id) => Ok(Outcome::Pending { request_id }),
        None => Err(AppError::Internal(anyhow::anyhow!(
            "Parcels returned an unfinished request without request_id"
        ))),
    };

    let mut results = resp.results.unwrap_or_default();
    let pos = results
        .iter()
        .position(|r| {
            r.tracking_number
                .as_deref()
                .is_some_and(|n| n.trim().eq_ignore_ascii_case(number))
        })
        .or(if results.is_empty() { None } else { Some(0) });
    let Some(result) = pos.map(|i| results.swap_remove(i)) else {
        return if resp.done {
            Err(AppError::NotFound)
        } else {
            pending()
        };
    };

    let processing = result.state.as_deref() == Some("processing");
    match result.shipment {
        Some(shipment) if !processing => to_status(shipment, carrier, number).map(Outcome::Done),
        _ if !resp.done || processing => pending(),
        _ => Err(AppError::NotFound),
    }
}

fn to_status(shipment: Shipment, carrier: &str, number: &str) -> AppResult<TrackingStatus> {
    // A terminal shipment-level error (number unknown to the carrier, extra
    // recipient fields required, …) — nothing to show beyond the link.
    if shipment.error.as_deref().is_some_and(|e| !e.trim().is_empty()) {
        return Err(AppError::NotFound);
    }

    let mut events: Vec<TrackingEvent> = shipment
        .states
        .unwrap_or_default()
        .into_iter()
        .filter_map(|s| {
            let description = s.state.unwrap_or_default().trim().to_string();
            if description.is_empty() {
                return None;
            }
            Some(TrackingEvent {
                timestamp: s
                    .date
                    .as_deref()
                    .and_then(|d| parse_event_time(d, s.utc_offset.as_deref())),
                description,
                location: s.location.filter(|l| !l.trim().is_empty()),
            })
        })
        .collect();
    // Most recent first, undated events last (stable: keeps Parcels' order
    // among equals).
    events.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));

    let status_code = shipment
        .status
        .map(|s| s.trim().to_lowercase())
        .filter(|s| !s.is_empty());
    if events.is_empty() && status_code.is_none() {
        // Carrier hasn't scanned it yet.
        return Err(AppError::NotFound);
    }
    let is_delivered = status_code.as_deref() == Some("delivered");
    let latest = events.first();
    let status = latest.map(|e| e.description.clone()).unwrap_or_else(|| {
        status_code
            .as_deref()
            .unwrap_or_default()
            .replace('_', " ")
    });
    let carrier_name = shipment
        .detected_carrier
        .and_then(|c| c.name)
        .or_else(|| {
            shipment
                .services
                .unwrap_or_default()
                .into_iter()
                .find_map(|c| c.name)
        })
        .filter(|n| !n.trim().is_empty());

    Ok(TrackingStatus {
        carrier: carrier.to_string(),
        number: number.to_string(),
        status,
        status_code,
        timestamp: latest.and_then(|e| e.timestamp),
        location: latest.and_then(|e| e.location.clone()),
        is_delivered,
        events,
        fetched_at: Utc::now(),
        carrier_name,
        provider: Some("parcels".into()),
        pending: false,
    })
}

/// Carrier-local scan time + optional UTC offset → UTC. Tolerates a value
/// that already carries a zone (`Z` / `+02:00`, the v4 format).
fn parse_event_time(date: &str, utc_offset: Option<&str>) -> Option<DateTime<Utc>> {
    let date = date.trim();
    if let Ok(dt) = DateTime::parse_from_rfc3339(date) {
        return Some(dt.with_timezone(&Utc));
    }
    let naive = [
        "%Y-%m-%dT%H:%M:%S%.f",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%dT%H:%M",
        "%Y-%m-%d %H:%M:%S",
    ]
    .iter()
    .find_map(|f| NaiveDateTime::parse_from_str(date, f).ok())?;
    match utc_offset.and_then(parse_offset) {
        Some(offset) => offset
            .from_local_datetime(&naive)
            .single()
            .map(|dt| dt.with_timezone(&Utc)),
        None => Some(naive.and_utc()),
    }
}

/// `+05:30` / `-07:00` / `+0900` → a fixed offset.
fn parse_offset(s: &str) -> Option<FixedOffset> {
    let s = s.trim();
    let sign = match s.as_bytes().first()? {
        b'+' => 1,
        b'-' => -1,
        _ => return None,
    };
    let rest = s.get(1..)?;
    let (h, m) = match rest.split_once(':') {
        Some(parts) => parts,
        None if rest.len() == 4 => (rest.get(..2)?, rest.get(2..)?),
        None => (rest, "0"),
    };
    let secs = h.parse::<i32>().ok()? * 3600 + m.parse::<i32>().ok()? * 60;
    FixedOffset::east_opt(sign * secs)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The "completed from cache" example of the v5 contract (also what the
    /// public mock answers).
    const CACHED: &str = r#"{"request_id":"66f4f2c0e16b4c13bb7e0001","status":"completed","done":true,
      "expires_at":"2026-11-15T23:34:08.845Z","results":[{"tracking_number":"EX123456789JP",
      "state":"completed","from_cache":true,"shipment":{"trackingId":"EX123456789JP","status":"delivered",
      "states":[
        {"state":"Accepted at USPS Origin Facility","location":"Portland, OR, United States","date":"2026-06-22T14:30:00","utcOffset":"-07:00","carrier":0},
        {"state":"Delivered, In/At Mailbox","location":"Austin, TX, United States","date":"2026-06-25T13:42:00","utcOffset":"-05:00","carrier":0},
        {"state":"Out for Delivery","location":"Austin, TX, United States","date":"2026-06-25T07:15:00","utcOffset":"-05:00","carrier":0}],
      "services":[{"slug":"usps","name":"USPS"}],"detectedCarrier":{"slug":"usps","name":"USPS"}}}]}"#;

    fn parse(json: &str) -> TrackingResponse {
        serde_json::from_str(json).expect("valid fixture")
    }

    #[test]
    fn completed_response_is_normalised() {
        let Outcome::Done(s) = interpret(parse(CACHED), "auto", "EX123456789JP").unwrap() else {
            panic!("expected a finished lookup");
        };
        assert!(s.is_delivered);
        assert_eq!(s.status_code.as_deref(), Some("delivered"));
        assert_eq!(s.carrier_name.as_deref(), Some("USPS"));
        assert_eq!(s.provider.as_deref(), Some("parcels"));
        // Re-sorted most recent first, whatever order Parcels sent.
        assert_eq!(s.status, "Delivered, In/At Mailbox");
        assert_eq!(s.events.len(), 3);
        assert_eq!(s.events[2].description, "Accepted at USPS Origin Facility");
        // 13:42 at -05:00 is 18:42 UTC.
        assert_eq!(
            s.timestamp.unwrap().to_rfc3339(),
            "2026-06-25T18:42:00+00:00"
        );
        assert_eq!(s.location.as_deref(), Some("Austin, TX, United States"));
    }

    #[test]
    fn unfinished_request_is_pending() {
        let json = r#"{"request_id":"r1","status":"processing","done":false,
          "results":[{"tracking_number":"X1","state":"processing"}]}"#;
        assert!(matches!(
            interpret(parse(json), "auto", "X1"),
            Ok(Outcome::Pending { request_id }) if request_id == "r1"
        ));
        // No result row yet at all.
        let json = r#"{"request_id":"r2","done":false,"results":[]}"#;
        assert!(matches!(
            interpret(parse(json), "auto", "X1"),
            Ok(Outcome::Pending { .. })
        ));
    }

    #[test]
    fn untrackable_numbers_are_not_found() {
        let rejected = r#"{"request_id":"r","done":true,"results":[],
          "rejected":[{"index":0,"code":"INVALID_TRACKING_NUMBER"}]}"#;
        assert!(matches!(interpret(parse(rejected), "auto", "X"), Err(AppError::NotFound)));

        let errored = r#"{"request_id":"r","done":true,"results":[{"tracking_number":"X",
          "state":"completed","shipment":{"error":"ADDITIONAL_FIELDS_REQUIRED","states":[]}}]}"#;
        assert!(matches!(interpret(parse(errored), "auto", "X"), Err(AppError::NotFound)));

        let empty = r#"{"request_id":"r","done":true,"results":[{"tracking_number":"X",
          "state":"completed","shipment":{"states":[]}}]}"#;
        assert!(matches!(interpret(parse(empty), "auto", "X"), Err(AppError::NotFound)));
    }

    #[test]
    fn event_times_honour_the_offset() {
        let t = |d: &str, o: Option<&str>| parse_event_time(d, o).map(|x| x.to_rfc3339());
        assert_eq!(
            t("2026-11-13T15:05:33", Some("+01:00")).as_deref(),
            Some("2026-11-13T14:05:33+00:00")
        );
        assert_eq!(
            t("2026-11-13T15:05:33", Some("+0900")).as_deref(),
            Some("2026-11-13T06:05:33+00:00")
        );
        // Unknown offset → taken as UTC.
        assert_eq!(
            t("2026-11-13T15:05:33", None).as_deref(),
            Some("2026-11-13T15:05:33+00:00")
        );
        // v4-style zoned value.
        assert_eq!(
            t("2026-11-13T15:05:33Z", None).as_deref(),
            Some("2026-11-13T15:05:33+00:00")
        );
        assert_eq!(t("not a date", None), None);
    }

    #[test]
    fn hints_cover_the_unambiguous_carriers_only() {
        assert_eq!(carrier_hint("japanpost"), Some("japan-post"));
        assert_eq!(carrier_hint("colissimo"), Some("la-poste"));
        assert_eq!(carrier_hint("dpd"), None);
        assert_eq!(carrier_hint("auto"), None);
    }
}

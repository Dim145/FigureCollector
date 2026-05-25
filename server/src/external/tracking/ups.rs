//! UPS carrier client.
//!
//! Two-step flow:
//!   1. Exchange `UPS_CLIENT_ID` + `UPS_CLIENT_SECRET` for a short-lived
//!      bearer token (`onlinetools.ups.com/security/v1/oauth/token`). Token
//!      caching isn't worth the bookkeeping — exchange is cheap and the
//!      tracking result lands in the 15-min Postgres cache anyway.
//!   2. GET `/api/track/v1/details/{number}` with the bearer + a fresh
//!      `transId` correlation header.

use super::{FETCH_TIMEOUT_SECS, TrackingEvent, TrackingStatus, parse_iso8601, urlencoding};
use crate::config::TrackingConfig;
use crate::error::{AppError, AppResult};
use chrono::{DateTime, Utc};
use serde::Deserialize;
use std::time::Duration as StdDuration;

pub(super) async fn fetch(
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
    #[allow(dead_code)]
    struct ActivityStatus {
        description: Option<String>,
        /// UPS milestone code (e.g. "I" for In Transit). Same rationale
        /// as the LaPoste `code` field — captured for future use.
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
            timestamp: join_date_time(a.date.as_deref(), a.time.as_deref()),
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

/// UPS activity records have separate `date` (YYYYMMDD) + `time` (HHMMSS)
/// fields. Stitch them into a UTC timestamp — UPS doesn't expose timezone
/// per event, so this is approximate. Lives here (not in `mod.rs`) because
/// no other carrier uses this exact shape.
fn join_date_time(date: Option<&str>, time: Option<&str>) -> Option<DateTime<Utc>> {
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

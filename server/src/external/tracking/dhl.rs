//! DHL Express carrier client.
//!
//! Single `DHL-API-Key` header (`DHL_API_KEY` env). DHL's `track/shipments`
//! endpoint returns events newest-first already, and surfaces a top-level
//! `status` block with a stable lowercase code (`"delivered"` is what we
//! key off for the terminal flag).

use super::{FETCH_TIMEOUT_SECS, TrackingEvent, TrackingStatus, parse_iso8601, urlencoding};
use crate::config::TrackingConfig;
use crate::error::{AppError, AppResult};
use chrono::Utc;
use serde::Deserialize;
use std::time::Duration as StdDuration;

pub(super) async fn fetch(
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

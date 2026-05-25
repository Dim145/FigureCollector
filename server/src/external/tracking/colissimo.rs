//! Colissimo / La Poste carrier client.
//!
//! Single Okapi API key (`COLISSIMO_API_KEY` env). The Suivi v2 endpoint
//! returns events oldest-first; we surface most-recent first to match the
//! shape expected by the SPA.

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
    #[allow(dead_code)]
    struct Event {
        /// Carrier-specific event code (e.g. "DR1"). Kept for forward
        /// compatibility — we surface `label` to the SPA, but having `code`
        /// in the deserialised struct lets future logic key off it without
        /// re-touching this parser.
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
            description: e.label.unwrap_or_default().trim().to_string(),
            location: e.location.filter(|s| !s.trim().is_empty()),
        })
        .collect();
    events.reverse();

    let latest = events.first().cloned().unwrap_or_else(|| TrackingEvent {
        timestamp: None,
        description: "Aucun événement disponible".into(),
        location: None,
    });

    Ok(TrackingStatus {
        carrier: "colissimo".into(),
        number: number.to_string(),
        status: latest.description.clone(),
        // Colissimo's `code` is per-event; we surface label only at the
        // top level. The event-level code remains in the deserialised
        // struct for forward compat.
        status_code: None,
        timestamp: latest.timestamp,
        location: latest.location.clone(),
        is_delivered,
        events,
        fetched_at: Utc::now(),
    })
}

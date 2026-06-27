//! Bridges Postgres `NOTIFY ocr_changed` → `parse_invoice` + per-user WS event.
//!
//! The GPU worker writes the `document_ocr_jobs` row directly (its own DB
//! connection), so the server never sees the ready/failed transition through an
//! HTTP handler. A DB trigger fires `pg_notify`; this background task `LISTEN`s
//! and, on a `ready` job, runs the OCR text through the SAME `parse_invoice`
//! heuristics as Palier 1, stores the suggestion as the document's
//! `parsed_metadata`, then publishes a `DocumentParsed` event so the SPA
//! refetches and shows the review panel.

use crate::domain::{ocr_job, owned_document, service_health};
use crate::events::Event;
use crate::services::invoice;
use crate::state::AppState;
use sqlx::postgres::PgListener;
use std::time::Duration;
use uuid::Uuid;

const SERVICE: &str = "ocr_listener";

pub fn spawn(state: AppState) {
    tokio::spawn(async move {
        loop {
            if let Err(e) = run(&state).await {
                tracing::warn!(error = ?e, "ocr_listener stopped; reconnecting in 5s");
                let _ = service_health::record_error(&state.pool, SERVICE, &e.to_string()).await;
                tokio::time::sleep(Duration::from_secs(5)).await;
            }
        }
    });
}

async fn run(state: &AppState) -> anyhow::Result<()> {
    let mut listener = PgListener::connect_with(&state.pool).await?;
    listener.listen("ocr_changed").await?;
    tracing::info!("ocr_listener: listening on ocr_changed");
    let _ = service_health::beat(&state.pool, SERVICE, "listener", "ok", None).await;
    loop {
        let notif = listener.recv().await?;
        let _ = service_health::beat(&state.pool, SERVICE, "listener", "ok", None).await;
        let payload: serde_json::Value =
            serde_json::from_str(notif.payload()).unwrap_or(serde_json::Value::Null);
        let uuid_field = |k: &str| {
            payload
                .get(k)
                .and_then(|v| v.as_str())
                .and_then(|s| s.parse::<Uuid>().ok())
        };
        let job_state = payload.get("state").and_then(|v| v.as_str()).unwrap_or("");
        // Only the terminal transitions matter; ignore pending→processing.
        if job_state != "ready" && job_state != "failed" {
            continue;
        }
        let (Some(job_id), Some(document_id), Some(owned_id)) = (
            uuid_field("job_id"),
            uuid_field("document_id"),
            uuid_field("owned_item_id"),
        ) else {
            continue;
        };

        // Success: the OCR text is on the job row → parse + store the suggestion
        // (same heuristics as the in-process PDF path).
        if job_state == "ready" {
            match ocr_job::result_text_for_job(&state.pool, job_id).await {
                Ok(Some(text)) => {
                    let parsed = invoice::parse_invoice(&text);
                    match serde_json::to_value(&parsed) {
                        Ok(meta) => {
                            if let Err(e) = owned_document::set_parsed_metadata_by_doc(
                                &state.pool,
                                document_id,
                                &meta,
                            )
                            .await
                            {
                                tracing::warn!(error = ?e, %document_id, "ocr_listener: store parsed_metadata failed");
                            }
                        }
                        Err(e) => tracing::warn!(error = ?e, "ocr_listener: serialize failed"),
                    }
                }
                Ok(None) => tracing::warn!(%job_id, "ocr_listener: ready job has no result_text"),
                Err(e) => {
                    tracing::warn!(error = ?e, %job_id, "ocr_listener: result_text fetch failed")
                }
            }
        }

        // ready or failed → nudge the owner's tabs to refetch the suggestion.
        let owner: Option<(Uuid,)> =
            sqlx::query_as("SELECT user_id FROM owned_items WHERE id = $1")
                .bind(owned_id)
                .fetch_optional(&state.pool)
                .await
                .ok()
                .flatten();
        if let Some((user_id,)) = owner {
            state.events.publish(
                user_id,
                Event::DocumentParsed {
                    owned_id,
                    document_id,
                },
            );
        }
    }
}

//! Bridges Postgres `NOTIFY scan_changed` → per-user WebSocket events.
//!
//! The gsplat worker writes the `scans` row directly (it has its own DB
//! connection), so the server never observes the ready/failed/progress
//! transition through an HTTP handler. A DB trigger fires `pg_notify`; this
//! background task `LISTEN`s and republishes each change as a `ScanUpdated`
//! event to the scan's owning user, so the SPA refreshes live.

use crate::events::Event;
use crate::state::AppState;
use sqlx::postgres::PgListener;
use std::time::Duration;
use uuid::Uuid;

pub fn spawn(state: AppState) {
    tokio::spawn(async move {
        loop {
            if let Err(e) = run(&state).await {
                tracing::warn!(error = ?e, "scan_listener stopped; reconnecting in 5s");
                tokio::time::sleep(Duration::from_secs(5)).await;
            }
        }
    });
}

async fn run(state: &AppState) -> anyhow::Result<()> {
    let mut listener = PgListener::connect_with(&state.pool).await?;
    listener.listen("scan_changed").await?;
    tracing::info!("scan_listener: listening on scan_changed");
    loop {
        let notif = listener.recv().await?;
        let payload: serde_json::Value =
            serde_json::from_str(notif.payload()).unwrap_or(serde_json::Value::Null);
        let parse = |k: &str| {
            payload
                .get(k)
                .and_then(|v| v.as_str())
                .and_then(|s| s.parse::<Uuid>().ok())
        };
        let (Some(scan_id), Some(owned_id)) = (parse("scan_id"), parse("owned_item_id")) else {
            continue;
        };
        let owner: Option<(Uuid,)> =
            sqlx::query_as("SELECT user_id FROM owned_items WHERE id = $1")
                .bind(owned_id)
                .fetch_optional(&state.pool)
                .await
                .ok()
                .flatten();
        if let Some((user_id,)) = owner {
            state
                .events
                .publish(user_id, Event::ScanUpdated { scan_id, owned_id });
        }
    }
}

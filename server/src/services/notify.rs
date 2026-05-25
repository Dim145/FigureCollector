//! Notification dispatcher — the layer between event emitters and the
//! notification domain + external adapters.
//!
//! Callers from a mutation handler typically do:
//!
//! ```ignore
//! notify::dispatch(
//!     &state,
//!     user_id,
//!     notification::EVENT_ACHIEVEMENT_UNLOCKED,
//!     json!({ "code": "owned_first", "tier": "bronze", ... }),
//!     None,                   // no dedup key — every grant is a fresh event
//! ).await;
//! ```
//!
//! What `dispatch` does:
//!   1. Optional dedup — if a `dedup_key` is supplied, we skip the whole
//!      pipeline when it's already been used (date-based reminders).
//!   2. Writes the in-app row via `notification::record`.
//!   3. Publishes `Event::NotificationCreated` so live bells refresh.
//!   4. Spawns a tokio task that resolves channel routes + invokes
//!      adapters. Failures in any single adapter are logged + ignored —
//!      the in-app row is the source of truth.

use crate::domain::notification;
use crate::entity::achievements;
use crate::events::Event;
use crate::state::AppState;
use serde_json::json;
use uuid::Uuid;

/// Fire an event for a single user. See module docs for the full flow.
/// `dedup_key`, if `Some`, must be stable per (user_id, event_type) — if
/// the same triple has been seen before we skip. Useful for the daily
/// cron (key = `release_date` so we don't re-notify on subsequent ticks).
pub async fn dispatch(
    state: &AppState,
    user_id: Uuid,
    event_type: &str,
    payload: serde_json::Value,
    dedup_key: Option<&str>,
) -> bool {
    // Wrap the dedup-check + in-app row insert in a SINGLE transaction so a
    // crash between the two can't leave a dedup row blocking every future
    // retry. Previously the dedup row was inserted on the bare pool (auto-
    // committed) before the in-app row was written; a panic between those
    // two writes would mean the daily cron silently skipped that event
    // forever afterwards.
    let mut tx = match state.pool.begin().await {
        Ok(tx) => tx,
        Err(e) => {
            tracing::error!(error = ?e, user_id = %user_id, event_type, "failed to start notification tx");
            return false;
        }
    };

    if let Some(k) = dedup_key {
        match notification::try_mark_sent_tx(&mut tx, user_id, event_type, k).await {
            Ok(true) => {}
            Ok(false) => {
                tracing::debug!(user_id = %user_id, event_type, dedup_key = k, "notification deduped");
                // tx rolls back on drop — no row written.
                return false;
            }
            Err(e) => {
                tracing::warn!(error = ?e, "notification dedup check failed; aborting (a missed event is recoverable, a missing in-app row is not)");
                return false;
            }
        }
    }

    // In-app row — always, regardless of any external routing config.
    let n = match notification::record_tx(&mut tx, user_id, event_type, payload.clone()).await {
        Ok(n) => n,
        Err(e) => {
            tracing::error!(error = ?e, user_id = %user_id, event_type, "failed to record notification");
            return false;
        }
    };

    if let Err(e) = tx.commit().await {
        tracing::error!(error = ?e, user_id = %user_id, event_type, "failed to commit notification tx");
        return false;
    }

    // Tell the user's open tabs that a new notification just landed. We do
    // this AFTER the commit so the bell only refreshes on a successfully
    // persisted row — no flicker on a rolled-back write.
    state
        .events
        .publish(user_id, Event::NotificationCreated { id: n.id });

    // External channel fan-out (best-effort, non-blocking).
    let state2 = state.clone();
    let event_type = event_type.to_string();
    tokio::spawn(async move {
        fan_out_external(&state2, user_id, &event_type, payload).await;
    });

    true
}

/// Convenience: fan a batch of newly-unlocked achievements out through
/// the dispatcher. Used by every route that calls `achievement::check_and_grant`
/// so the wiring lives in exactly one place.
pub async fn dispatch_achievements(
    state: &AppState,
    user_id: Uuid,
    unlocked: &[achievements::Model],
) {
    for a in unlocked {
        let payload = json!({
            "code": a.code,
            "tier": a.tier,
            "category": a.category,
            "kind": a.kind,
            "threshold": a.threshold,
        });
        // No dedup — `check_and_grant` already guards against double-grant
        // via the unique index on (user_id, achievement_code).
        dispatch(
            state,
            user_id,
            notification::EVENT_ACHIEVEMENT_UNLOCKED,
            payload,
            None,
        )
        .await;
    }
}

/// Resolves the user's enabled external channels for this event_type and
/// hands the payload to each adapter. Adapter failures are logged but
/// don't propagate — the in-app row is still there.
async fn fan_out_external(
    state: &AppState,
    user_id: Uuid,
    event_type: &str,
    payload: serde_json::Value,
) {
    let routes = match notification::resolve_routes(&state.pool, user_id, event_type).await {
        Ok(r) => r,
        Err(e) => {
            tracing::warn!(error = ?e, "failed to resolve notification routes");
            return;
        }
    };

    for route in routes {
        // Each adapter call is independent — wrap in catch so one bad
        // channel doesn't poison the loop.
        let result = crate::external::notify_channel::dispatch_to_channel(
            state,
            user_id,
            &route.channel_type,
            &route.system_config,
            &route.destination,
            event_type,
            &payload,
        )
        .await;
        if let Err(e) = result {
            tracing::warn!(
                channel = route.channel_type,
                error = ?e,
                "notification channel adapter failed"
            );
        }
    }
}

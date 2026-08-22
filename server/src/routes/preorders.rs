//! `/api/me/preorders/*` — pre-orders with release-date slip history.

use crate::auth;
use crate::domain::preorder::{HistoryEntryPatch, NewPreorder, PreorderPatch};
use crate::domain::{achievement, activity, preorder};
use crate::error::AppResult;
use crate::events::Event;
use crate::state::AppState;
use axum::{
    Json, Router,
    extract::{Path, State},
    http::StatusCode,
    routing::{get, patch as patch_method},
};
use tower_sessions::Session;
use uuid::Uuid;

async fn list_mine(
    State(state): State<AppState>,
    session: Session,
) -> AppResult<Json<Vec<preorder::PreorderWithFigure>>> {
    let user_id = auth::require_user(&session).await?;
    Ok(Json(preorder::list_for_user(&state.pool, user_id).await?))
}

async fn add_mine(
    State(state): State<AppState>,
    session: Session,
    Json(input): Json<NewPreorder>,
) -> AppResult<(StatusCode, Json<preorder::Preorder>)> {
    let user_id = auth::require_user(&session).await?;
    // Freeze the cost→EUR rate at save time when a real price is recorded
    // (covers price + deposit + refund, which share price_currency).
    let price_fx_rate = match (&input.price_amount, input.price_currency.as_deref()) {
        (Some(_), Some(cur)) => {
            crate::external::fx::freeze_rate_to_eur(&state.pool, &state.http, cur).await
        }
        _ => None,
    };
    let po = preorder::create(&state.pool, user_id, input, price_fx_rate).await?;

    let mut snap = activity::figure_snapshot(&state.pool, po.figure_id).await;
    if let Some(obj) = snap.as_object_mut() {
        obj.insert("preorder_id".into(), serde_json::Value::String(po.id.to_string()));
        obj.insert("status".into(), serde_json::Value::String(po.status.clone()));
        if let Some(d) = po.release_date_current {
            obj.insert("release_date".into(), serde_json::Value::String(d.to_string()));
        }
        // `po.store` used to be the free-text store name; now it's
        // `store_id` (UUID, less useful in activity snapshots). The
        // store name can be recovered by following the preorder_id
        // link, so we skip embedding it here.
    }
    activity::record(&state.pool, user_id, "preorder_created", snap).await;
    state.cache.invalidate_user_collection(user_id).await;

    state.events.publish(
        user_id,
        Event::PreorderCreated {
            preorder_id: po.id,
            figure_id: po.figure_id,
        },
    );

    if let Ok(newly) =
        achievement::check_and_grant(&state.db, &state.pool, user_id, Some(po.figure_id)).await
    {
        if !newly.is_empty() {
            state.events.publish(
                user_id,
                Event::AchievementsUnlocked {
                    codes: newly.iter().map(|a| a.code.clone()).collect(),
                },
            );
            crate::services::notify::dispatch_achievements(&state, user_id, &newly).await;
        }
    }

    Ok((StatusCode::CREATED, Json(po)))
}

async fn patch_mine(
    State(state): State<AppState>,
    session: Session,
    Path(id): Path<Uuid>,
    Json(input): Json<PreorderPatch>,
) -> AppResult<Json<preorder::Preorder>> {
    let user_id = auth::require_user(&session).await?;

    // Capture the pre-patch state so we can emit accurate activity events.
    let before: Option<(Uuid, String, Option<chrono::NaiveDate>)> = sqlx::query_as(
        "SELECT figure_id, status, release_date_current FROM preorders WHERE id = $1 AND user_id = $2",
    )
    .bind(id)
    .bind(user_id)
    .fetch_optional(&state.pool)
    .await
    .ok()
    .flatten();

    // Re-freeze the cost rate for the patch's currency; the UPDATE only adopts
    // it on a real currency change (or first capture).
    let price_fx_rate = match input.price_currency.as_deref() {
        Some(cur) => crate::external::fx::freeze_rate_to_eur(&state.pool, &state.http, cur).await,
        None => None,
    };
    let updated = preorder::patch(&state.pool, user_id, id, input, price_fx_rate).await?;
    state.cache.invalidate_user_collection(user_id).await;

    if let Some((figure_id, prev_status, prev_date)) = before {
        let mut snap = activity::figure_snapshot(&state.pool, figure_id).await;
        if let Some(obj) = snap.as_object_mut() {
            obj.insert("preorder_id".into(), serde_json::Value::String(id.to_string()));
        }

        // Status change
        if prev_status != updated.status {
            let mut s = snap.clone();
            if let Some(obj) = s.as_object_mut() {
                obj.insert("from_status".into(), serde_json::Value::String(prev_status));
                obj.insert(
                    "to_status".into(),
                    serde_json::Value::String(updated.status.clone()),
                );
            }
            let kind = if updated.status == "received" {
                "preorder_received"
            } else {
                "preorder_status_changed"
            };
            activity::record(&state.pool, user_id, kind, s).await;
        }

        // Release-date slip
        if prev_date != updated.release_date_current {
            let mut s = snap.clone();
            if let Some(obj) = s.as_object_mut() {
                if let Some(d) = prev_date {
                    obj.insert("from_date".into(), serde_json::Value::String(d.to_string()));
                }
                if let Some(d) = updated.release_date_current {
                    obj.insert("to_date".into(), serde_json::Value::String(d.to_string()));
                }
            }
            activity::record(&state.pool, user_id, "preorder_slipped", s).await;
        }
    }

    state
        .events
        .publish(user_id, Event::PreorderUpdated { preorder_id: id });

    // Status changes can flip "preorders_received" — re-evaluate.
    // The patched preorder's figure is the natural trigger.
    if let Ok(newly) = achievement::check_and_grant(
        &state.db,
        &state.pool,
        user_id,
        Some(updated.figure_id),
    )
    .await
    {
        if !newly.is_empty() {
            state.events.publish(
                user_id,
                Event::AchievementsUnlocked {
                    codes: newly.iter().map(|a| a.code.clone()).collect(),
                },
            );
            crate::services::notify::dispatch_achievements(&state, user_id, &newly).await;
        }
    }

    Ok(Json(updated))
}

async fn delete_mine(
    State(state): State<AppState>,
    session: Session,
    Path(id): Path<Uuid>,
) -> AppResult<StatusCode> {
    let user_id = auth::require_user(&session).await?;
    preorder::delete_for_user(&state.pool, user_id, id).await?;
    state.cache.invalidate_user_collection(user_id).await;
    state
        .events
        .publish(user_id, Event::PreorderDeleted { preorder_id: id });
    Ok(StatusCode::NO_CONTENT)
}

async fn history_mine(
    State(state): State<AppState>,
    session: Session,
    Path(id): Path<Uuid>,
) -> AppResult<Json<Vec<preorder::DateHistoryEntry>>> {
    let user_id = auth::require_user(&session).await?;
    Ok(Json(preorder::history(&state.pool, user_id, id).await?))
}

/// PATCH a single slip-history entry. Only the `note` field is editable —
/// dates + source are immutable record.
async fn patch_history_entry(
    State(state): State<AppState>,
    session: Session,
    Path((id, entry_id)): Path<(Uuid, Uuid)>,
    Json(input): Json<HistoryEntryPatch>,
) -> AppResult<Json<preorder::DateHistoryEntry>> {
    let user_id = auth::require_user(&session).await?;
    Ok(Json(
        preorder::patch_history_note(&state.pool, user_id, id, entry_id, input).await?,
    ))
}

async fn by_owned(
    State(state): State<AppState>,
    session: Session,
    Path(owned_id): Path<Uuid>,
) -> AppResult<Json<Option<preorder::Preorder>>> {
    let user_id = auth::require_user(&session).await?;
    Ok(Json(
        preorder::find_by_owned_item(&state.pool, user_id, owned_id).await?,
    ))
}

/// Slip statistics over the user's own pre-order history: one overall row plus
/// a per-maker breakdown (only makers with enough observations to mean
/// anything). Read-only aggregate over `preorder_date_history`.
#[derive(serde::Serialize)]
struct SlipReport {
    overall: crate::domain::preorder_slip::SlipStat,
    by_manufacturer: Vec<crate::domain::preorder_slip::SlipStat>,
    /// Minimum observations a maker needs before it gets its own row — sent so
    /// the UI can explain an empty breakdown instead of looking broken.
    min_samples: i64,
}

async fn slip_stats(
    State(state): State<AppState>,
    session: Session,
) -> AppResult<Json<SlipReport>> {
    let user_id = auth::require_user(&session).await?;
    Ok(Json(SlipReport {
        overall: crate::domain::preorder_slip::overall(&state.pool, user_id).await?,
        by_manufacturer: crate::domain::preorder_slip::per_manufacturer(&state.pool, user_id)
            .await?,
        min_samples: crate::domain::preorder_slip::MIN_SAMPLES,
    }))
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/me/preorders", get(list_mine).post(add_mine))
        .route("/me/preorders/slip-stats", get(slip_stats))
        .route(
            "/me/preorders/{id}",
            patch_method(patch_mine).delete(delete_mine),
        )
        .route("/me/preorders/{id}/history", get(history_mine))
        .route(
            "/me/preorders/{id}/history/{entry_id}",
            patch_method(patch_history_entry),
        )
        .route("/me/owned/{owned_id}/preorder", get(by_owned))
}

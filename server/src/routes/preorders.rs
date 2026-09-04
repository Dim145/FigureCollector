//! `/api/me/preorders/*` — pre-orders with release-date slip history.

use crate::auth;
use crate::domain::preorder::{HistoryEntryPatch, NewPreorder, PreorderPatch};
use crate::domain::preorder;
use crate::error::AppResult;
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
    let po = crate::services::collection::add_preorder(&state, user_id, input).await?;
    Ok((StatusCode::CREATED, Json(po)))
}

async fn patch_mine(
    State(state): State<AppState>,
    session: Session,
    Path(id): Path<Uuid>,
    Json(input): Json<PreorderPatch>,
) -> AppResult<Json<preorder::Preorder>> {
    let user_id = auth::require_user(&session).await?;
    Ok(Json(
        crate::services::collection::patch_preorder(&state, user_id, id, input).await?,
    ))
}

async fn delete_mine(
    State(state): State<AppState>,
    session: Session,
    Path(id): Path<Uuid>,
) -> AppResult<StatusCode> {
    let user_id = auth::require_user(&session).await?;
    crate::services::collection::delete_preorder(&state, user_id, id).await?;
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

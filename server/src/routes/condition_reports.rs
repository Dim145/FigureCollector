//! Arrival QC — `/api/me/owned/{id}/condition-reports` and friends.
//!
//! Every handler resolves the session user first and every query in
//! [`crate::domain::condition_report`] is scoped by that id: a report describes
//! damage to someone's own property, and the owned-item / report / defect ids
//! all arrive from the client.

use crate::auth;
use crate::domain::condition_report::{
    self, Defect, NewDefect, NewReport, Report, ReportPatch, ReportWithDefects,
};
use crate::error::AppResult;
use crate::state::AppState;
use axum::{
    Json, Router,
    extract::{Path, State},
    routing::{get, patch as patch_method, post},
};
use chrono::NaiveDate;
use serde::Deserialize;
use tower_sessions::Session;
use uuid::Uuid;

async fn list_mine(
    State(state): State<AppState>,
    session: Session,
    Path(owned_id): Path<Uuid>,
) -> AppResult<Json<Vec<ReportWithDefects>>> {
    let user_id = auth::require_user(&session).await?;
    Ok(Json(
        condition_report::list_for_item(&state.pool, user_id, owned_id).await?,
    ))
}

async fn create_mine(
    State(state): State<AppState>,
    session: Session,
    Path(owned_id): Path<Uuid>,
    Json(input): Json<NewReport>,
) -> AppResult<Json<Report>> {
    let user_id = auth::require_user(&session).await?;
    Ok(Json(
        condition_report::create(&state.pool, user_id, owned_id, input).await?,
    ))
}

async fn patch_mine(
    State(state): State<AppState>,
    session: Session,
    Path(report_id): Path<Uuid>,
    Json(input): Json<ReportPatch>,
) -> AppResult<Json<Report>> {
    let user_id = auth::require_user(&session).await?;
    Ok(Json(
        condition_report::patch(&state.pool, user_id, report_id, input).await?,
    ))
}

async fn delete_mine(
    State(state): State<AppState>,
    session: Session,
    Path(report_id): Path<Uuid>,
) -> AppResult<Json<serde_json::Value>> {
    let user_id = auth::require_user(&session).await?;
    condition_report::delete(&state.pool, user_id, report_id).await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

async fn add_defect(
    State(state): State<AppState>,
    session: Session,
    Path(report_id): Path<Uuid>,
    Json(input): Json<NewDefect>,
) -> AppResult<Json<Defect>> {
    let user_id = auth::require_user(&session).await?;
    Ok(Json(
        condition_report::add_defect(&state.pool, user_id, report_id, input).await?,
    ))
}

#[derive(Deserialize)]
struct ResolveInput {
    /// `null` un-resolves — a "fixed" defect that turns out not to be is a
    /// state the log has to be able to walk back.
    #[serde(default)]
    resolved_on: Option<NaiveDate>,
}

async fn resolve_defect(
    State(state): State<AppState>,
    session: Session,
    Path(defect_id): Path<Uuid>,
    Json(input): Json<ResolveInput>,
) -> AppResult<Json<Defect>> {
    let user_id = auth::require_user(&session).await?;
    Ok(Json(
        condition_report::resolve_defect(&state.pool, user_id, defect_id, input.resolved_on)
            .await?,
    ))
}

async fn delete_defect(
    State(state): State<AppState>,
    session: Session,
    Path(defect_id): Path<Uuid>,
) -> AppResult<Json<serde_json::Value>> {
    let user_id = auth::require_user(&session).await?;
    condition_report::delete_defect(&state.pool, user_id, defect_id).await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/me/owned/{owned_id}/condition-reports",
            get(list_mine).post(create_mine),
        )
        .route(
            "/me/condition-reports/{report_id}",
            patch_method(patch_mine).delete(delete_mine),
        )
        .route("/me/condition-reports/{report_id}/defects", post(add_defect))
        .route(
            "/me/condition-defects/{defect_id}",
            patch_method(resolve_defect).delete(delete_defect),
        )
}

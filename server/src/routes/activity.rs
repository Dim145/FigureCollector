//! `/api/me/activity` — chronological activity feed.
//! `/api/me/year-in-review/{year}` — aggregated retrospective.

use crate::auth;
use crate::domain::activity::{self, ListParams};
use crate::error::AppResult;
use crate::state::AppState;
use axum::{
    Json, Router,
    extract::{Path, Query, State},
    routing::get,
};
use serde::Deserialize;
use tower_sessions::Session;

#[derive(Deserialize)]
struct ListQuery {
    limit: Option<i64>,
    offset: Option<i64>,
}

async fn list_mine(
    State(state): State<AppState>,
    session: Session,
    Query(q): Query<ListQuery>,
) -> AppResult<Json<Vec<activity::ActivityEvent>>> {
    let user_id = auth::require_user(&session).await?;
    let params = ListParams {
        limit: q.limit.unwrap_or(50),
        offset: q.offset.unwrap_or(0),
    };
    Ok(Json(
        activity::list_for_user(&state.pool, user_id, params).await?,
    ))
}

async fn year_in_review(
    State(state): State<AppState>,
    session: Session,
    Path(year): Path<i32>,
) -> AppResult<Json<activity::YearInReview>> {
    let user_id = auth::require_user(&session).await?;
    if !(1990..=2100).contains(&year) {
        return Err(crate::error::AppError::BadRequest("year out of range"));
    }
    Ok(Json(activity::year_in_review(&state.pool, user_id, year).await?))
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/me/activity", get(list_mine))
        .route("/me/year-in-review/{year}", get(year_in_review))
}

//! Landed-cost estimator — `/api/landed-cost`.
//!
//! Pure arithmetic over an operator-maintained rule table (see
//! [`crate::domain::landed_cost`]): no tax API, nothing about what a user buys
//! leaves the instance. Signed-in only, since it's a personal planning tool.

use crate::auth;
use crate::domain::landed_cost::{self, Breakdown, Quote, Rules};
use crate::error::AppResult;
use crate::state::AppState;
use axum::{
    Json, Router,
    extract::State,
    routing::{get, post},
};
use tower_sessions::Session;

/// `None` for an unknown destination — the SPA then says "no rule for this
/// country" rather than showing a fabricated total.
async fn quote(
    State(state): State<AppState>,
    session: Session,
    Json(q): Json<Quote>,
) -> AppResult<Json<Option<Breakdown>>> {
    auth::require_user(&session).await?;
    let rules = landed_cost::rules(&state.pool).await?;
    Ok(Json(landed_cost::estimate(&rules, &q)))
}

/// The rule table itself, so the UI can show what it applied (and an admin can
/// see what they're editing).
async fn get_rules(State(state): State<AppState>, session: Session) -> AppResult<Json<Rules>> {
    auth::require_user(&session).await?;
    Ok(Json(landed_cost::rules(&state.pool).await?))
}

async fn put_rules(
    State(state): State<AppState>,
    session: Session,
    Json(rules): Json<Rules>,
) -> AppResult<Json<Rules>> {
    auth::require_admin(&session, &state.pool).await?;
    landed_cost::set_rules(&state.pool, &rules).await?;
    Ok(Json(rules))
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/landed-cost", post(quote))
        .route("/landed-cost/rules", get(get_rules).put(put_rules))
}

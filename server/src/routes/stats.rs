//! `/api/me/stats` — aggregate breakdowns for the signed-in user's collection.
//!
//! Single-shot endpoint so the StatsPage can render in one round-trip. The
//! payload is small (a handful of arrays, max 10 entries each).

use crate::auth;
use crate::domain::figure_price;
use crate::domain::stats::{self, CollectionStats, Insights};
use crate::error::AppResult;
use crate::state::AppState;
use axum::{Json, Router, extract::State, routing::get};
use tower_sessions::Session;

async fn my_stats(
    State(state): State<AppState>,
    session: Session,
) -> AppResult<Json<CollectionStats>> {
    let user_id = auth::require_user(&session).await?;
    Ok(Json(stats::collection_stats(&state.pool, user_id).await?))
}

/// Deeper insights (Lot 5): spend-over-time, series completion, wishlist value,
/// preorder health. Separate endpoint so it loads independently of the
/// headline stats.
async fn my_insights(
    State(state): State<AppState>,
    session: Session,
) -> AppResult<Json<Insights>> {
    let user_id = auth::require_user(&session).await?;
    Ok(Json(stats::insights(&state.pool, user_id).await?))
}

/// Market-price history across every figure the user owns, oldest first and
/// tagged by figure. One round-trip for the Cote page: per-row sparklines,
/// expanded registres, and the reconstructed collection evolution curve.
async fn my_price_history(
    State(state): State<AppState>,
    session: Session,
) -> AppResult<Json<Vec<figure_price::OwnedPricePoint>>> {
    let user_id = auth::require_user(&session).await?;
    Ok(Json(
        figure_price::history_for_user_owned(&state.pool, user_id).await?,
    ))
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/me/stats", get(my_stats))
        .route("/me/insights", get(my_insights))
        .route("/me/price-history", get(my_price_history))
}

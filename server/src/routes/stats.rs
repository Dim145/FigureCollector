//! `/api/me/stats` — aggregate breakdowns for the signed-in user's collection.
//!
//! Single-shot endpoint so the StatsPage can render in one round-trip. The
//! payload is small (a handful of arrays, max 10 entries each).

use crate::auth;
use crate::cache;
use crate::domain::figure_price;
use crate::domain::stats;
use crate::error::AppResult;
use crate::state::AppState;
use axum::{Router, extract::State, response::Response, routing::get};
use std::time::Duration;
use tower_sessions::Session;

// These per-user aggregates change only when the user edits their collection —
// the owned/preorder/wishlist mutation handlers drop the keys (see
// `Cache::invalidate_user_collection`), so the TTL is just a safety net.
const STATS_TTL: Duration = Duration::from_secs(60);
const INSIGHTS_TTL: Duration = Duration::from_secs(60);
// Price history also shifts when the market-price cron runs (a few times/day);
// the cron doesn't invalidate per-user, so a 10 min TTL bounds that staleness.
const PRICE_HISTORY_TTL: Duration = Duration::from_secs(600);

async fn my_stats(State(state): State<AppState>, session: Session) -> AppResult<Response> {
    let user_id = auth::require_user(&session).await?;
    state
        .cache
        .json_cached(&cache::user_stats_key(user_id), STATS_TTL, || {
            stats::collection_stats(&state.pool, &state.http, user_id)
        })
        .await
}

/// Deeper insights (Lot 5): spend-over-time, series completion, wishlist value,
/// preorder health. Separate endpoint so it loads independently of the
/// headline stats.
async fn my_insights(State(state): State<AppState>, session: Session) -> AppResult<Response> {
    let user_id = auth::require_user(&session).await?;
    state
        .cache
        .json_cached(&cache::user_insights_key(user_id), INSIGHTS_TTL, || {
            stats::insights(&state.pool, user_id)
        })
        .await
}

/// Collection-over-time (#10): monthly buckets of pieces added + outlay added
/// (per currency), reconstructed from existing owned-item data. The SPA folds
/// these into a cumulative items + cumulative spend curve and converts spend
/// via the display-currency layer. Same per-user cache lifecycle as the stats.
async fn my_timeline(State(state): State<AppState>, session: Session) -> AppResult<Response> {
    let user_id = auth::require_user(&session).await?;
    state
        .cache
        .json_cached(&cache::user_timeline_key(user_id), STATS_TTL, || {
            stats::collection_timeline(&state.pool, user_id)
        })
        .await
}

/// Market-price history across every figure the user owns, oldest first and
/// tagged by figure. One round-trip for the Cote page: per-row sparklines,
/// expanded registres, and the reconstructed collection evolution curve.
async fn my_price_history(State(state): State<AppState>, session: Session) -> AppResult<Response> {
    let user_id = auth::require_user(&session).await?;
    state
        .cache
        .json_cached(
            &cache::user_price_history_key(user_id),
            PRICE_HISTORY_TTL,
            || figure_price::history_for_user_owned(&state.pool, user_id),
        )
        .await
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/me/stats", get(my_stats))
        .route("/me/insights", get(my_insights))
        .route("/me/timeline", get(my_timeline))
        .route("/me/price-history", get(my_price_history))
}

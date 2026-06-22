//! `/api/catalogue/*` — the read-only aggregation endpoints behind the
//! catalogue (`/catalogue`) redesign.
//!
//!   - `GET /api/catalogue/facets`   — public, NSFW-pref aware. Aggregated
//!     counts per dimension (manufacturers / series / characters / scales /
//!     types / tags), busiest first. Powers the facet rail, the explore bento
//!     and the "popular" search proxy. Cached, keyed by the resolved NSFW pref.
//!   - `GET /api/catalogue/discover` — auth, NSFW-pref aware. The curated rails
//!     (recently added, upcoming pre-orders, from your favourite studios).
//!
//! Both honour the viewer's `nsfw_visibility` exactly like `/api/figures` and
//! the tag facets: a `hide` pref (and every anonymous caller, for `/facets`)
//! drops NSFW figures from the scan.

use std::time::Duration;

use axum::{
    Json, Router,
    extract::State,
    response::Response,
    routing::get,
};
use tower_sessions::Session;

use crate::auth;
use crate::domain::catalogue;
use crate::error::AppResult;
use crate::state::AppState;

/// Aggregated catalogue facets. Public — browsing doesn't require a session.
/// Cached 10 min like the tag facets (it scans the whole catalogue); the cache
/// key includes the resolved NSFW pref so a `hide` viewer never gets a payload
/// computed with NSFW rows included, and vice-versa.
async fn facets(State(state): State<AppState>, session: Session) -> AppResult<Response> {
    let exclude_nsfw = nsfw_hidden(&session, &state.pool).await;
    let key = if exclude_nsfw {
        "catalogue-facets:sfw"
    } else {
        "catalogue-facets:all"
    };
    state
        .cache
        .json_cached(key, Duration::from_secs(600), || {
            catalogue::facets(&state.pool, exclude_nsfw)
        })
        .await
}

/// The curated discovery rails for the signed-in viewer. Auth required: the
/// "favourite studios" rail is derived from the viewer's own owned items.
async fn discover(
    State(state): State<AppState>,
    session: Session,
) -> AppResult<Json<catalogue::Discover>> {
    let user = auth::require_user_full(&session, &state.pool).await?;
    let exclude_nsfw = user.nsfw_visibility == "hide";
    Ok(Json(
        catalogue::discover(&state.pool, user.id, exclude_nsfw).await?,
    ))
}

/// `true` when the viewer wants NSFW hidden — their `nsfw_visibility` is
/// "hide", or they're anonymous (the hide-by-default baseline). Mirrors the
/// `nsfw_pref` logic of the figures list / entity routes.
async fn nsfw_hidden(session: &Session, pool: &sqlx::PgPool) -> bool {
    auth::require_user_full(session, pool)
        .await
        .ok()
        .map(|u| u.nsfw_visibility.as_str() == "hide")
        .unwrap_or(true)
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/catalogue/facets", get(facets))
        .route("/catalogue/discover", get(discover))
}

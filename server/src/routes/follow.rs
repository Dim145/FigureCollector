//! Social graph HTTP surface (Lot 4) — same-instance follow/unfollow, the
//! "Discover collectors" gallery, and the follower / following lists.
//!
//! POST   /api/me/follows/{username}  : follow a collector
//! DELETE /api/me/follows/{username}  : unfollow
//! GET    /api/collectors?q=          : discover public collectors
//! GET    /api/u/{slug}/followers     : who follows this profile
//! GET    /api/u/{slug}/following     : who this profile follows

use crate::auth;
use crate::domain::follow::{self, CollectorCard, Direction};
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use axum::{
    Json, Router,
    extract::{Path, Query, State},
    routing::{get, post},
};
use serde::{Deserialize, Serialize};
use tower_sessions::Session;
use uuid::Uuid;

/// Returned by follow / unfollow so the SPA can flip the button and update
/// the target's follower count without a refetch.
#[derive(Serialize)]
struct FollowStatus {
    is_following: bool,
    followers: i64,
}

/// Resolve a username to a user id, or 404. No public-profile gate — you can
/// follow anyone reachable by handle (following never exposes their data).
async fn resolve_username(state: &AppState, username: &str) -> AppResult<Uuid> {
    let user = auth::user::find_by_username(&state.pool, username)
        .await?
        .ok_or(AppError::NotFound)?;
    Ok(user.id)
}

/// Resolve a username requiring a *public* profile — used by the list
/// endpoints, which only hang off a public profile.
async fn resolve_public(state: &AppState, username: &str) -> AppResult<Uuid> {
    let user = auth::user::find_by_username(&state.pool, username)
        .await?
        .filter(|u| u.public_profile_enabled)
        .ok_or(AppError::NotFound)?;
    Ok(user.id)
}

async fn follow_user(
    State(state): State<AppState>,
    session: Session,
    Path(username): Path<String>,
) -> AppResult<Json<FollowStatus>> {
    let me = auth::require_user(&session).await?;
    let target = resolve_username(&state, &username).await?;
    if target == me {
        return Err(AppError::BadRequest("cannot follow yourself"));
    }
    follow::follow(&state.pool, me, target).await?;
    let (followers, _following) = follow::counts(&state.pool, target).await?;
    Ok(Json(FollowStatus {
        is_following: true,
        followers,
    }))
}

async fn unfollow_user(
    State(state): State<AppState>,
    session: Session,
    Path(username): Path<String>,
) -> AppResult<Json<FollowStatus>> {
    let me = auth::require_user(&session).await?;
    let target = resolve_username(&state, &username).await?;
    follow::unfollow(&state.pool, me, target).await?;
    let (followers, _following) = follow::counts(&state.pool, target).await?;
    Ok(Json(FollowStatus {
        is_following: false,
        followers,
    }))
}

#[derive(Deserialize)]
struct DiscoverQuery {
    #[serde(default)]
    q: String,
}

async fn discover(
    State(state): State<AppState>,
    session: Session,
    Query(query): Query<DiscoverQuery>,
) -> AppResult<Json<Vec<CollectorCard>>> {
    let me = auth::require_user(&session).await?;
    let cards = follow::discover(&state.pool, me, query.q.trim()).await?;
    Ok(Json(cards))
}

async fn followers(
    State(state): State<AppState>,
    session: Session,
    Path(slug): Path<String>,
) -> AppResult<Json<Vec<CollectorCard>>> {
    let viewer = auth::optional_user(&session).await?;
    let target = resolve_public(&state, &slug).await?;
    let list = follow::list_relations(&state.pool, viewer, target, Direction::Followers).await?;
    Ok(Json(list))
}

async fn following(
    State(state): State<AppState>,
    session: Session,
    Path(slug): Path<String>,
) -> AppResult<Json<Vec<CollectorCard>>> {
    let viewer = auth::optional_user(&session).await?;
    let target = resolve_public(&state, &slug).await?;
    let list = follow::list_relations(&state.pool, viewer, target, Direction::Following).await?;
    Ok(Json(list))
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/collectors", get(discover))
        .route(
            "/me/follows/{username}",
            post(follow_user).delete(unfollow_user),
        )
        .route("/u/{slug}/followers", get(followers))
        .route("/u/{slug}/following", get(following))
}

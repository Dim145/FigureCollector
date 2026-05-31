//! Gift-list sharing.
//!
//! Two surfaces:
//!   * `/api/me/gift-list*` — owner-only (require_user): read share state,
//!     enable (mint a token), disable (kill the link + wipe reservations).
//!     The owner never sees reservations here.
//!   * `/api/g/{token}` — **anonymous** (optional_user): the public gift list.
//!     Anyone with the link sees the wishlist and who has claimed what, and can
//!     reserve / release a piece. Reservations are hidden when the viewer *is*
//!     the owner, so opening your own link can't spoil the surprise.

use crate::auth::{self, user};
use crate::domain::{gift, wishlist};
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use axum::{
    Json, Router,
    extract::{Path, Query, State},
    http::StatusCode,
    routing::{get, post},
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tower_sessions::Session;
use uuid::Uuid;

// ── Owner side ──────────────────────────────────────────────────────────────

#[derive(Serialize)]
struct ShareState {
    enabled: bool,
    token: Option<String>,
}

async fn get_share(State(state): State<AppState>, session: Session) -> AppResult<Json<ShareState>> {
    let user_id = auth::require_user(&session).await?;
    let token = gift::share_token(&state.pool, user_id).await?;
    Ok(Json(ShareState {
        enabled: token.is_some(),
        token,
    }))
}

async fn enable_share(
    State(state): State<AppState>,
    session: Session,
) -> AppResult<Json<ShareState>> {
    let user_id = auth::require_user(&session).await?;
    let token = gift::enable_share(&state.pool, user_id).await?;
    Ok(Json(ShareState {
        enabled: true,
        token: Some(token),
    }))
}

async fn disable_share(
    State(state): State<AppState>,
    session: Session,
) -> AppResult<StatusCode> {
    let user_id = auth::require_user(&session).await?;
    gift::disable_share(&state.pool, user_id).await?;
    Ok(StatusCode::NO_CONTENT)
}

// ── Public side (anonymous, by token) ────────────────────────────────────────

#[derive(Serialize)]
struct PublicItem {
    #[serde(flatten)]
    item: wishlist::WishlistItem,
    reserved: bool,
    /// Who claimed it — visible to gift-givers, never to the owner.
    reserved_by: Option<String>,
}

#[derive(Serialize)]
struct PublicGiftList {
    owner_name: String,
    /// True when the viewer is the owner — the SPA then hides reservations and
    /// the reserve buttons (reservations are already stripped server-side).
    is_owner: bool,
    /// Whether the owner exposes NSFW pieces on their public surfaces. The SPA
    /// only offers the anonymous "reveal" toggle when this is true.
    owner_allows_nsfw: bool,
    /// How many NSFW pieces are hidden from the current viewer right now (0 when
    /// shown, or when the owner doesn't share NSFW at all — never leaks).
    hidden_nsfw: i64,
    items: Vec<PublicItem>,
}

#[derive(Deserialize)]
struct PublicQuery {
    /// Anonymous NSFW reveal, from the viewer's localStorage. Ignored for
    /// signed-in viewers — their own `nsfw_visibility` governs.
    #[serde(default)]
    nsfw: Option<String>,
}

async fn public_list(
    State(state): State<AppState>,
    session: Session,
    Path(token): Path<String>,
    Query(q): Query<PublicQuery>,
) -> AppResult<Json<PublicGiftList>> {
    let owner = user::find_by_gift_token(&state.pool, &token)
        .await?
        .ok_or(AppError::NotFound)?;
    let viewer = auth::optional_user(&session).await?;
    let is_owner = viewer == Some(owner.id);

    // NSFW gate. The owner's public-profile NSFW switch is the hard ceiling;
    // beyond that the viewer must opt in — their own visibility setting when
    // signed in, an explicit `?nsfw=1` (from localStorage) when anonymous.
    let owner_allows_nsfw = owner.public_profile_show_nsfw;
    let viewer_wants_nsfw = match viewer {
        Some(uid) if uid == owner.id => owner.nsfw_visibility != "hide",
        Some(uid) => user::find_by_id(&state.pool, uid)
            .await?
            .map(|u| u.nsfw_visibility != "hide")
            .unwrap_or(false),
        None => q.nsfw.as_deref() == Some("1"),
    };
    let show_nsfw = owner_allows_nsfw && viewer_wants_nsfw;

    let all = wishlist::list(&state.pool, owner.id, false).await?;
    // Only ever reveal that NSFW exists when the owner actually shares it.
    let hidden_nsfw = if owner_allows_nsfw && !show_nsfw {
        all.iter().filter(|i| i.is_nsfw).count() as i64
    } else {
        0
    };

    // Reservations are the surprise — strip them entirely for the owner.
    let reserved: HashMap<Uuid, String> = if is_owner {
        HashMap::new()
    } else {
        gift::reservations_for_owner(&state.pool, owner.id)
            .await?
            .into_iter()
            .map(|r| (r.figure_id, r.reserver_name))
            .collect()
    };

    let items = all
        .into_iter()
        .filter(|it| show_nsfw || !it.is_nsfw)
        .map(|item| {
            let reserved_by = reserved.get(&item.figure_id).cloned();
            PublicItem {
                reserved: reserved_by.is_some(),
                reserved_by,
                item,
            }
        })
        .collect();

    Ok(Json(PublicGiftList {
        owner_name: owner.display_name,
        is_owner,
        owner_allows_nsfw,
        hidden_nsfw,
        items,
    }))
}

#[derive(Deserialize)]
struct ReserveBody {
    figure_id: Uuid,
    reserver_name: String,
}

#[derive(Serialize)]
struct ReserveResult {
    reserver_token: String,
}

async fn reserve(
    State(state): State<AppState>,
    session: Session,
    Path(token): Path<String>,
    Json(body): Json<ReserveBody>,
) -> AppResult<Json<ReserveResult>> {
    let owner = user::find_by_gift_token(&state.pool, &token)
        .await?
        .ok_or(AppError::NotFound)?;

    // The owner can't claim their own pieces — that would spoil the surprise.
    if auth::optional_user(&session).await? == Some(owner.id) {
        return Err(AppError::Forbidden);
    }

    let name = body.reserver_name.trim();
    if name.is_empty() || name.chars().count() > 60 {
        return Err(AppError::BadRequest("reserver_name must be 1–60 characters"));
    }

    // The owner's public-profile NSFW switch is the same ceiling applied to the
    // public read view — a hidden NSFW piece can't be reserved either.
    let reserver_token = gift::reserve(
        &state.pool,
        owner.id,
        body.figure_id,
        name,
        owner.public_profile_show_nsfw,
    )
    .await?;
    Ok(Json(ReserveResult { reserver_token }))
}

#[derive(Deserialize)]
struct ReleaseBody {
    figure_id: Uuid,
    reserver_token: String,
}

async fn release(
    State(state): State<AppState>,
    Path(token): Path<String>,
    Json(body): Json<ReleaseBody>,
) -> AppResult<StatusCode> {
    let owner = user::find_by_gift_token(&state.pool, &token)
        .await?
        .ok_or(AppError::NotFound)?;
    gift::release(&state.pool, owner.id, body.figure_id, &body.reserver_token).await?;
    Ok(StatusCode::NO_CONTENT)
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/me/gift-list", get(get_share))
        .route("/me/gift-list/share", post(enable_share).delete(disable_share))
        .route("/g/{token}", get(public_list))
        .route("/g/{token}/reserve", post(reserve))
        .route("/g/{token}/release", post(release))
}

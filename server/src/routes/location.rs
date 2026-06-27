//! `/api/me/locations` — the signed-in user's display cabinets ("vitrines").
//!
//! Plus two share surfaces, mirroring the gift list:
//!   * authed `PATCH /api/me/vitrines/{cabinet_id}/share` — mint/clear a public
//!     share token for one cabinet.
//!   * **anonymous** `GET /api/v/{token}` — the public, read-only cabinet view
//!     (mounted unauthenticated in `routes::mod`, like `/api/g/{token}`).

use crate::auth::{self, user};
use crate::domain::location::{self, LocationPatch, NewLocation};
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use axum::{
    Json, Router,
    extract::{Path, Query, State},
    http::StatusCode,
    routing::{get, patch as patch_method},
};
use serde::{Deserialize, Serialize};
use tower_sessions::Session;
use uuid::Uuid;

async fn list_mine(
    State(state): State<AppState>,
    session: Session,
) -> AppResult<Json<Vec<location::CollectionLocation>>> {
    let user_id = auth::require_user(&session).await?;
    Ok(Json(location::list(&state.pool, user_id).await?))
}

async fn create_mine(
    State(state): State<AppState>,
    session: Session,
    Json(input): Json<NewLocation>,
) -> AppResult<(StatusCode, Json<location::CollectionLocation>)> {
    let user_id = auth::require_user(&session).await?;
    let loc = location::create(&state.pool, user_id, input).await?;
    Ok((StatusCode::CREATED, Json(loc)))
}

async fn patch_mine(
    State(state): State<AppState>,
    session: Session,
    Path(id): Path<Uuid>,
    Json(input): Json<LocationPatch>,
) -> AppResult<Json<location::CollectionLocation>> {
    let user_id = auth::require_user(&session).await?;
    Ok(Json(location::patch(&state.pool, user_id, id, input).await?))
}

async fn delete_mine(
    State(state): State<AppState>,
    session: Session,
    Path(id): Path<Uuid>,
) -> AppResult<StatusCode> {
    let user_id = auth::require_user(&session).await?;
    location::delete(&state.pool, user_id, id).await?;
    Ok(StatusCode::NO_CONTENT)
}

// ── Share state (owner side, authenticated) ──────────────────────────────────

#[derive(Deserialize)]
struct ShareBody {
    enabled: bool,
}

#[derive(Serialize)]
struct ShareState {
    enabled: bool,
    token: Option<String>,
}

/// PATCH /me/vitrines/{cabinet_id}/share — body `{enabled}`. Enabling mints (or
/// reuses) a token and returns `{enabled:true, token}`; disabling clears it and
/// returns `{enabled:false, token:null}`. Mirrors the gift-list share endpoint.
async fn patch_share(
    State(state): State<AppState>,
    session: Session,
    Path(cabinet_id): Path<Uuid>,
    Json(body): Json<ShareBody>,
) -> AppResult<Json<ShareState>> {
    let user_id = auth::require_user(&session).await?;
    if body.enabled {
        let token = location::enable_share(&state.pool, user_id, cabinet_id).await?;
        Ok(Json(ShareState {
            enabled: true,
            token: Some(token),
        }))
    } else {
        location::disable_share(&state.pool, user_id, cabinet_id).await?;
        Ok(Json(ShareState {
            enabled: false,
            token: None,
        }))
    }
}

// ── Public cabinet (anonymous, by token) ─────────────────────────────────────

#[derive(Serialize)]
struct PublicCabinetResponse {
    cabinet_name: String,
    owner_name: String,
    /// True when the viewer is the cabinet's owner — the SPA shows a "this is
    /// your own link" hint (read-only either way).
    is_owner: bool,
    /// Whether the owner exposes NSFW pieces publicly — the SPA only offers the
    /// anonymous "reveal" toggle when this is true.
    owner_allows_nsfw: bool,
    /// How many NSFW pieces are hidden from the current viewer right now (0 when
    /// shown, or when the owner doesn't share NSFW at all — never leaks).
    hidden_nsfw: i64,
    items: Vec<location::PublicCabinetEntry>,
}

#[derive(Deserialize)]
struct PublicQuery {
    /// Anonymous NSFW reveal, from the viewer's localStorage. Ignored for
    /// signed-in viewers — their own `nsfw_visibility` governs.
    #[serde(default)]
    nsfw: Option<String>,
}

async fn public_cabinet(
    State(state): State<AppState>,
    session: Session,
    Path(token): Path<String>,
    Query(q): Query<PublicQuery>,
) -> AppResult<Json<PublicCabinetResponse>> {
    let owner = user::find_by_vitrine_token(&state.pool, &token)
        .await?
        .ok_or(AppError::NotFound)?;
    let viewer = auth::optional_user(&session).await?;
    let is_owner = viewer == Some(owner.id);

    // NSFW gate — identical to the gift public list: the owner's public-profile
    // NSFW switch is the hard ceiling; beyond that the viewer must opt in (their
    // own visibility when signed in, an explicit `?nsfw=1` when anonymous).
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

    // Fetch the full set once, then filter in Rust (mirrors `gift::public_list`)
    // — one query, and the hidden count comes for free.
    let cabinet = location::get_public_cabinet(&state.pool, &token).await?;

    // Only ever reveal that NSFW exists when the owner actually shares it (0
    // when shown, or when the owner doesn't share NSFW at all — never leaks).
    let hidden_nsfw = if owner_allows_nsfw && !show_nsfw {
        cabinet.items.iter().filter(|i| i.is_nsfw).count() as i64
    } else {
        0
    };
    let items = cabinet
        .items
        .into_iter()
        .filter(|it| show_nsfw || !it.is_nsfw)
        .collect();

    Ok(Json(PublicCabinetResponse {
        cabinet_name: cabinet.cabinet_name,
        owner_name: owner.display_name,
        is_owner,
        owner_allows_nsfw,
        hidden_nsfw,
        items,
    }))
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/me/locations", get(list_mine).post(create_mine))
        .route("/me/locations/{id}", patch_method(patch_mine).delete(delete_mine))
        .route("/me/vitrines/{cabinet_id}/share", patch_method(patch_share))
}

/// Anonymous, token-only public cabinet view. Mounted without auth (and behind
/// the shared abuse limiter) in `routes::mod`, alongside the gift public routes.
pub fn public_router() -> Router<AppState> {
    Router::new().route("/v/{token}", get(public_cabinet))
}

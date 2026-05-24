//! `/api/external/*` — proxied + cached lookups against third-party metadata
//! providers (AniList, MFC). Authenticated to keep the cache from being
//! abused by anonymous traffic.

use crate::auth;
use crate::error::{AppError, AppResult};
use crate::external::{anilist, mal, mfc, orzgk, tracking};
use crate::state::AppState;
use axum::{
    Json, Router,
    extract::{Path, Query, State},
    routing::get,
};
use serde::Deserialize;
use tower_sessions::Session;

#[derive(Deserialize)]
struct SearchQuery {
    q: Option<String>,
}

#[derive(Deserialize)]
struct UrlQuery {
    url: Option<String>,
}

async fn anilist_search(
    State(state): State<AppState>,
    session: Session,
    Query(q): Query<SearchQuery>,
) -> AppResult<Json<Vec<anilist::AniListMedia>>> {
    auth::require_user(&session).await?;
    let query = q.q.unwrap_or_default();
    if query.trim().len() < 2 {
        return Err(AppError::BadRequest("query must be at least 2 chars"));
    }
    Ok(Json(
        anilist::search_media(&state.pool, &state.http, &query).await?,
    ))
}

async fn anilist_get(
    State(state): State<AppState>,
    session: Session,
    Path(id): Path<i64>,
) -> AppResult<Json<anilist::MediaDetail>> {
    auth::require_user(&session).await?;
    Ok(Json(
        anilist::get_media_with_characters(&state.pool, &state.http, id).await?,
    ))
}

async fn anilist_character_get(
    State(state): State<AppState>,
    session: Session,
    Path(id): Path<i64>,
) -> AppResult<Json<anilist::AniListCharacter>> {
    auth::require_user(&session).await?;
    Ok(Json(
        anilist::get_character(&state.pool, &state.http, id).await?,
    ))
}

async fn mfc_get(
    State(state): State<AppState>,
    session: Session,
    Path(id): Path<i64>,
) -> AppResult<Json<mfc::MfcItem>> {
    auth::require_user(&session).await?;
    Ok(Json(mfc::get_item(&state.pool, &state.http, id).await?))
}

/// Search MFC by name. Falls through to the same Cloudflare wall as
/// `mfc::get_item` today — we expose the route shape so the SPA can degrade
/// gracefully when the moment a fetch path opens up.
async fn mfc_search(
    State(_state): State<AppState>,
    session: Session,
    Query(q): Query<SearchQuery>,
) -> AppResult<Json<Vec<mfc::MfcItem>>> {
    auth::require_user(&session).await?;
    let _ = q.q;
    Err(AppError::FeatureDisabled(
        "MFC search needs a working fetcher (Cloudflare blocks direct HTTP). \
         Wire one in `external::mfc::fetch_item_html` and update this route.",
    ))
}

async fn orzgk_search(
    State(state): State<AppState>,
    session: Session,
    Query(q): Query<SearchQuery>,
) -> AppResult<Json<Vec<orzgk::OrzgkItem>>> {
    auth::require_user(&session).await?;
    let query = q.q.unwrap_or_default();
    if query.trim().len() < 2 {
        return Err(AppError::BadRequest("query must be at least 2 chars"));
    }
    Ok(Json(orzgk::search(&state.pool, &state.http, &query).await?))
}

/// Fetch + cache a single orzgk product page. Used by the lookup modal once
/// the user has either picked a result card or pasted a `/product/<slug>/`
/// URL directly. The handler rejects URLs that aren't on `www.orzgk.com` so
/// we don't turn into a generic HTTP proxy.
async fn orzgk_detail(
    State(state): State<AppState>,
    session: Session,
    Query(q): Query<UrlQuery>,
) -> AppResult<Json<orzgk::OrzgkDetail>> {
    auth::require_user(&session).await?;
    let url = q
        .url
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or(AppError::BadRequest("missing url parameter"))?;
    Ok(Json(
        orzgk::detail(&state.pool, &state.http, url).await?,
    ))
}

// ─── MAL via Jikan ──────────────────────────────────────────────────────────

async fn mal_anime_search(
    State(state): State<AppState>,
    session: Session,
    Query(q): Query<SearchQuery>,
) -> AppResult<Json<Vec<mal::MalAnime>>> {
    auth::require_user(&session).await?;
    let query = q.q.unwrap_or_default();
    if query.trim().len() < 2 {
        return Err(AppError::BadRequest("query must be at least 2 chars"));
    }
    Ok(Json(
        mal::search_anime(&state.pool, &state.http, &query).await?,
    ))
}

async fn mal_anime_get(
    State(state): State<AppState>,
    session: Session,
    Path(id): Path<i64>,
) -> AppResult<Json<mal::MalAnime>> {
    auth::require_user(&session).await?;
    Ok(Json(mal::get_anime(&state.pool, &state.http, id).await?))
}

async fn mal_character_search(
    State(state): State<AppState>,
    session: Session,
    Query(q): Query<SearchQuery>,
) -> AppResult<Json<Vec<mal::MalCharacter>>> {
    auth::require_user(&session).await?;
    let query = q.q.unwrap_or_default();
    if query.trim().len() < 2 {
        return Err(AppError::BadRequest("query must be at least 2 chars"));
    }
    Ok(Json(
        mal::search_character(&state.pool, &state.http, &query).await?,
    ))
}

async fn mal_character_get(
    State(state): State<AppState>,
    session: Session,
    Path(id): Path<i64>,
) -> AppResult<Json<mal::MalCharacter>> {
    auth::require_user(&session).await?;
    Ok(Json(
        mal::get_character(&state.pool, &state.http, id).await?,
    ))
}

// ─── Live shipping tracking proxy ─────────────────────────────────────────
//
// Browser → /api/tracking/{carrier}/{number} → server-side fetch against
// the carrier API using a key from env (CORS + auth makes a direct browser
// call impossible). Response is normalised + cached.

async fn tracking_get(
    State(state): State<AppState>,
    session: Session,
    Path((carrier, number)): Path<(String, String)>,
) -> AppResult<Json<tracking::TrackingStatus>> {
    auth::require_user(&session).await?;
    Ok(Json(
        tracking::fetch(
            &state.pool,
            &state.http,
            &state.config.tracking,
            &carrier,
            &number,
        )
        .await?,
    ))
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/tracking/{carrier}/{number}",
            get(tracking_get),
        )
        .route("/external/anilist/search", get(anilist_search))
        .route("/external/anilist/{id}", get(anilist_get))
        .route("/external/anilist/character/{id}", get(anilist_character_get))
        .route("/external/mfc/search", get(mfc_search))
        .route("/external/mfc/{id}", get(mfc_get))
        .route("/external/orzgk/search", get(orzgk_search))
        .route("/external/orzgk/detail", get(orzgk_detail))
        .route("/external/mal/anime/search", get(mal_anime_search))
        .route("/external/mal/anime/{id}", get(mal_anime_get))
        .route("/external/mal/character/search", get(mal_character_search))
        .route("/external/mal/character/{id}", get(mal_character_get))
}

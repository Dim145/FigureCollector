//! `/api/external/*` — proxied + cached lookups against third-party metadata
//! providers (AniList, MFC). Authenticated to keep the cache from being
//! abused by anonymous traffic.

use crate::auth;
use crate::error::{AppError, AppResult};
use crate::external::{anilist, mfc};
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

async fn mfc_get(
    State(state): State<AppState>,
    session: Session,
    Path(id): Path<i64>,
) -> AppResult<Json<mfc::MfcItem>> {
    auth::require_user(&session).await?;
    Ok(Json(mfc::get_item(&state.pool, &state.http, id).await?))
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/external/anilist/search", get(anilist_search))
        .route("/external/anilist/{id}", get(anilist_get))
        .route("/external/mfc/{id}", get(mfc_get))
}

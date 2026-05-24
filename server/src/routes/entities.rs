//! `/api/manufacturers/:slug`, `/api/series/:slug`, `/api/characters/:slug` —
//! public catalog pages, plus the proxied entity-image route for Garage
//! uploads (`/api/entity-image/{kind}/{id}`).
//!
//! All three GET endpoints return a single JSON document:
//! ```json
//! { "entity": { … }, "figures": [ … ] }
//! ```
//! Read-only and unauthenticated (browsing the catalog doesn't require a
//! session). NSFW filtering follows the viewer's `nsfw_visibility` exactly
//! like `/api/figures`.

use crate::auth;
use crate::domain::entity::{self, KIND_CHARACTER, KIND_MANUFACTURER, KIND_SERIES};
use crate::domain::figure::Figure;
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use axum::{
    Json, Router,
    body::Body,
    extract::{Path, State},
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::IntoResponse,
    routing::get,
};
use serde::Serialize;
use tower_sessions::Session;
use uuid::Uuid;

// =============================================================================
// Public entity GET endpoints
// =============================================================================

#[derive(Serialize)]
struct ManufacturerPage {
    entity: entity::ManufacturerView,
    figures: Vec<Figure>,
}

async fn get_manufacturer(
    State(state): State<AppState>,
    session: Session,
    Path(slug): Path<String>,
) -> AppResult<Json<ManufacturerPage>> {
    let m = entity::find_manufacturer_by_slug(&state.pool, &slug)
        .await?
        .ok_or(AppError::NotFound)?;
    let exclude_nsfw = nsfw_pref(&session, &state.pool).await;
    let figures = entity::figures_for_manufacturer(&state.pool, m.id, exclude_nsfw).await?;
    Ok(Json(ManufacturerPage {
        entity: entity::ManufacturerView::from(m),
        figures,
    }))
}

#[derive(Serialize)]
struct SeriesPage {
    entity: entity::SeriesView,
    figures: Vec<Figure>,
}

async fn get_series(
    State(state): State<AppState>,
    session: Session,
    Path(slug): Path<String>,
) -> AppResult<Json<SeriesPage>> {
    let s = entity::find_series_by_slug(&state.pool, &slug)
        .await?
        .ok_or(AppError::NotFound)?;
    let exclude_nsfw = nsfw_pref(&session, &state.pool).await;
    let figures = entity::figures_for_series(&state.pool, s.id, exclude_nsfw).await?;
    Ok(Json(SeriesPage {
        entity: entity::SeriesView::from(s),
        figures,
    }))
}

#[derive(Serialize)]
struct CharacterPage {
    entity: entity::CharacterView,
    figures: Vec<Figure>,
}

async fn get_character(
    State(state): State<AppState>,
    session: Session,
    Path(slug): Path<String>,
) -> AppResult<Json<CharacterPage>> {
    let c = entity::find_character_by_slug(&state.pool, &slug)
        .await?
        .ok_or(AppError::NotFound)?;
    let exclude_nsfw = nsfw_pref(&session, &state.pool).await;
    let figures = entity::figures_for_character(&state.pool, c.id, exclude_nsfw).await?;
    Ok(Json(CharacterPage {
        entity: entity::CharacterView::from(c),
        figures,
    }))
}

// =============================================================================
// Image proxy — `/api/entity-image/{kind}/{id}`
// =============================================================================
//
// When `image_key` is set on an entity, the [`entity::*View`] helpers point
// the SPA at this route instead of an external URL. We fetch the bytes from
// Garage and stream them back with a long cache header (the key changes
// every upload, so cache invalidation is automatic).

async fn entity_image(
    State(state): State<AppState>,
    Path((kind, id)): Path<(String, Uuid)>,
) -> AppResult<impl IntoResponse> {
    let key_opt = match kind.as_str() {
        k if k == KIND_MANUFACTURER => {
            sqlx::query_scalar::<_, Option<String>>(
                "SELECT image_key FROM manufacturers WHERE id = $1",
            )
            .bind(id)
            .fetch_optional(&state.pool)
            .await?
            .flatten()
        }
        k if k == KIND_SERIES => {
            sqlx::query_scalar::<_, Option<String>>(
                "SELECT image_key FROM series WHERE id = $1",
            )
            .bind(id)
            .fetch_optional(&state.pool)
            .await?
            .flatten()
        }
        k if k == KIND_CHARACTER => {
            sqlx::query_scalar::<_, Option<String>>(
                "SELECT image_key FROM characters WHERE id = $1",
            )
            .bind(id)
            .fetch_optional(&state.pool)
            .await?
            .flatten()
        }
        _ => return Err(AppError::NotFound),
    };
    let key = key_opt.ok_or(AppError::NotFound)?;
    let (bytes, mime) = state.storage.get(&key).await?;
    let mut headers = HeaderMap::new();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_str(mime.as_deref().unwrap_or("image/webp"))
            .unwrap_or_else(|_| HeaderValue::from_static("image/webp")),
    );
    // Cache-busting via the object key: same key always returns the same
    // bytes; on re-upload the key changes, so the CDN sees a new URL.
    headers.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("public, max-age=31536000, immutable"),
    );
    Ok((StatusCode::OK, headers, Body::from(bytes)))
}

// =============================================================================
// Helpers
// =============================================================================

/// Resolve the viewer's NSFW preference. Anonymous viewers default to
/// hiding — same baseline as the figures list.
async fn nsfw_pref(session: &Session, pool: &sqlx::PgPool) -> bool {
    let viewer = auth::require_user_full(session, pool).await.ok();
    let pref = viewer
        .as_ref()
        .map(|u| u.nsfw_visibility.as_str())
        .unwrap_or("hide");
    pref == "hide"
}

// =============================================================================
// Router
// =============================================================================

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/manufacturers/{slug}", get(get_manufacturer))
        .route("/series/{slug}", get(get_series))
        .route("/characters/{slug}", get(get_character))
        .route("/entity-image/{kind}/{id}", get(entity_image))
}

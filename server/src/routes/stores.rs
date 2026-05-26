//! `/api/stores/*` — promoted from a free-text column into a first-class
//! entity in migration 22. Three surfaces:
//!
//!   - public list / detail / catalogue  (any signed-in user)
//!   - admin CRUD                        (require_admin)
//!   - admin image upload                (multipart, lives in
//!                                        admin::photo_upload_router)
//!
//! The admin routes are registered inside `routes/admin.rs` for consistency
//! with the rest of the admin surface. This file just owns the public side.

use crate::auth;
use crate::domain::store::{self, LinkedStore, StoreCatalogFigure};
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
use tower_sessions::Session;
use uuid::Uuid;

async fn list_stores(
    State(state): State<AppState>,
    session: Session,
) -> AppResult<Json<Vec<store::Store>>> {
    auth::require_user(&session).await?;
    Ok(Json(store::list(&state.pool).await?))
}

async fn get_store(
    State(state): State<AppState>,
    session: Session,
    Path(slug): Path<String>,
) -> AppResult<Json<store::Store>> {
    auth::require_user(&session).await?;
    Ok(Json(store::get_by_slug(&state.pool, &slug).await?))
}

/// Figures linked to this store via at least one owned_item OR preorder.
/// Respects the user's NSFW preference (hide → exclude NSFW figures).
async fn store_catalog(
    State(state): State<AppState>,
    session: Session,
    Path(slug): Path<String>,
) -> AppResult<Json<Vec<StoreCatalogFigure>>> {
    let user = auth::require_user_full(&session, &state.pool).await?;
    let s = store::get_by_slug(&state.pool, &slug).await?;
    let exclude_nsfw = user.nsfw_visibility == "hide";
    Ok(Json(
        store::catalog(&state.pool, s.id, exclude_nsfw).await?,
    ))
}

/// Stores currently linked to a figure. Powers the "Boutiques" button +
/// popup on /figures/:id — any signed-in user can see this list.
async fn list_stores_for_figure(
    State(state): State<AppState>,
    session: Session,
    Path(figure_id): Path<Uuid>,
) -> AppResult<Json<Vec<LinkedStore>>> {
    auth::require_user(&session).await?;
    Ok(Json(store::stores_for_figure(&state.pool, figure_id).await?))
}

/// Serve the store's profile image from Garage by store id. Kept ID-based
/// (not key-based) so the raw storage key never appears in URLs — the
/// admin can rotate the image and the cache key flips automatically since
/// the storage key changes on every upload.
async fn store_image(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> AppResult<impl IntoResponse> {
    let key = sqlx::query_scalar::<_, Option<String>>(
        "SELECT image_storage_key FROM stores WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(&state.pool)
    .await?
    .flatten()
    .ok_or(AppError::NotFound)?;
    let (bytes, mime) = state.storage.get(&key).await?;
    let mut headers = HeaderMap::new();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_str(mime.as_deref().unwrap_or("image/webp"))
            .unwrap_or_else(|_| HeaderValue::from_static("image/webp")),
    );
    headers.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("public, max-age=31536000, immutable"),
    );
    Ok((StatusCode::OK, headers, Body::from(bytes)))
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/stores", get(list_stores))
        .route("/stores/{slug}", get(get_store))
        .route("/stores/{slug}/catalog", get(store_catalog))
        .route("/store-image/{id}", get(store_image))
        .route("/figures/{id}/stores", get(list_stores_for_figure))
}

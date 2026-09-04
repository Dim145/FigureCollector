//! `/api/me/wishlist/*` — the signed-in user's wishlist (catalogue figures
//! they covet, with an optional target price + note).

use crate::auth;
use crate::domain::wishlist::{self, NewWishlistItem, WishlistPatch};
use crate::error::AppResult;
use crate::state::AppState;
use axum::{
    Json, Router,
    extract::{Path, State},
    http::StatusCode,
    routing::{get, patch as patch_method},
};
use tower_sessions::Session;
use uuid::Uuid;

async fn list_mine(
    State(state): State<AppState>,
    session: Session,
) -> AppResult<Json<Vec<wishlist::WishlistItem>>> {
    let user = auth::require_user_full(&session, &state.pool).await?;
    let exclude = user.nsfw_visibility == "hide";
    Ok(Json(wishlist::list(&state.pool, user.id, exclude).await?))
}

async fn add_mine(
    State(state): State<AppState>,
    session: Session,
    Json(input): Json<NewWishlistItem>,
) -> AppResult<(StatusCode, Json<wishlist::WishlistItem>)> {
    let user_id = auth::require_user(&session).await?;
    let item = crate::services::collection::add_wishlist_item(&state, user_id, input).await?;
    Ok((StatusCode::CREATED, Json(item)))
}

async fn patch_mine(
    State(state): State<AppState>,
    session: Session,
    Path(figure_id): Path<Uuid>,
    Json(input): Json<WishlistPatch>,
) -> AppResult<Json<wishlist::WishlistItem>> {
    let user_id = auth::require_user(&session).await?;
    Ok(Json(
        crate::services::collection::patch_wishlist_item(&state, user_id, figure_id, input).await?,
    ))
}

async fn delete_mine(
    State(state): State<AppState>,
    session: Session,
    Path(figure_id): Path<Uuid>,
) -> AppResult<StatusCode> {
    let user_id = auth::require_user(&session).await?;
    crate::services::collection::remove_wishlist_item(&state, user_id, figure_id).await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Market-price history for every wished figure, oldest first and tagged by
/// figure — one round-trip so the wishlist can draw a sparkline per row and
/// say how far today's price sits above its observed floor.
async fn my_wishlist_price_history(
    State(state): State<AppState>,
    session: Session,
) -> AppResult<Json<Vec<crate::domain::figure_price::OwnedPricePoint>>> {
    let user_id = auth::require_user(&session).await?;
    Ok(Json(
        crate::domain::figure_price::history_for_user_wished(&state.pool, user_id).await?,
    ))
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/me/wishlist", get(list_mine).post(add_mine))
        .route("/me/wishlist/price-history", get(my_wishlist_price_history))
        .route(
            "/me/wishlist/{figure_id}",
            patch_method(patch_mine).delete(delete_mine),
        )
}

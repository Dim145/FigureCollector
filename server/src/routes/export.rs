//! Data export endpoints (Lot 5) — download the signed-in user's collection /
//! wishlist / preorders as CSV or JSON, or a single-file JSON backup.
//!
//! Every response carries `Content-Disposition: attachment` so the browser
//! saves a file instead of rendering it. Auth-gated to the session user; a
//! plain `<a href download>` works because the cookie rides along.

use crate::auth;
use crate::domain::export;
use crate::error::AppResult;
use crate::state::AppState;
use axum::{
    Router,
    extract::State,
    http::header,
    response::IntoResponse,
    routing::get,
};
use tower_sessions::Session;

const CSV: &str = "text/csv; charset=utf-8";
const JSON: &str = "application/json; charset=utf-8";

fn attachment(filename: &str, content_type: &str, body: String) -> impl IntoResponse {
    (
        [
            (header::CONTENT_TYPE, content_type.to_string()),
            (
                header::CONTENT_DISPOSITION,
                format!("attachment; filename=\"{filename}\""),
            ),
        ],
        body,
    )
}

async fn collection_csv(
    State(state): State<AppState>,
    session: Session,
) -> AppResult<impl IntoResponse> {
    let uid = auth::require_user(&session).await?;
    Ok(attachment(
        "collection.csv",
        CSV,
        export::collection_csv(&state.pool, uid).await?,
    ))
}

async fn collection_json(
    State(state): State<AppState>,
    session: Session,
) -> AppResult<impl IntoResponse> {
    let uid = auth::require_user(&session).await?;
    Ok(attachment(
        "collection.json",
        JSON,
        export::collection_json(&state.pool, uid).await?,
    ))
}

async fn wishlist_csv(
    State(state): State<AppState>,
    session: Session,
) -> AppResult<impl IntoResponse> {
    let uid = auth::require_user(&session).await?;
    Ok(attachment(
        "wishlist.csv",
        CSV,
        export::wishlist_csv(&state.pool, uid).await?,
    ))
}

async fn wishlist_json(
    State(state): State<AppState>,
    session: Session,
) -> AppResult<impl IntoResponse> {
    let uid = auth::require_user(&session).await?;
    Ok(attachment(
        "wishlist.json",
        JSON,
        export::wishlist_json(&state.pool, uid).await?,
    ))
}

async fn preorders_csv(
    State(state): State<AppState>,
    session: Session,
) -> AppResult<impl IntoResponse> {
    let uid = auth::require_user(&session).await?;
    Ok(attachment(
        "preorders.csv",
        CSV,
        export::preorders_csv(&state.pool, uid).await?,
    ))
}

async fn preorders_json(
    State(state): State<AppState>,
    session: Session,
) -> AppResult<impl IntoResponse> {
    let uid = auth::require_user(&session).await?;
    Ok(attachment(
        "preorders.json",
        JSON,
        export::preorders_json(&state.pool, uid).await?,
    ))
}

async fn backup_json(
    State(state): State<AppState>,
    session: Session,
) -> AppResult<impl IntoResponse> {
    let uid = auth::require_user(&session).await?;
    Ok(attachment(
        "figurecollector-backup.json",
        JSON,
        export::backup_json(&state.pool, uid).await?,
    ))
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/me/export/collection.csv", get(collection_csv))
        .route("/me/export/collection.json", get(collection_json))
        .route("/me/export/wishlist.csv", get(wishlist_csv))
        .route("/me/export/wishlist.json", get(wishlist_json))
        .route("/me/export/preorders.csv", get(preorders_csv))
        .route("/me/export/preorders.json", get(preorders_json))
        .route("/me/export/backup.json", get(backup_json))
}

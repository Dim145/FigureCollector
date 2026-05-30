//! `/api/figures/*` — figurine catalog (manual entry today; scraping in Phase 2B).

use crate::auth;
use crate::domain::figure::{self, FigurePatch, NewFigure};
use crate::domain::figure_type;
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use axum::{
    Json, Router,
    extract::{Path, Query, State},
    http::StatusCode,
    routing::{get, post},
};
use serde::Deserialize;
use tower_sessions::Session;
use uuid::Uuid;

#[derive(Debug, Deserialize)]
struct DuplicateQuery {
    name: Option<String>,
    jan: Option<String>,
}

/// Live duplicate check for the create form: figures already in the catalogue
/// matching by JAN (strong) or name (soft). The SPA derives the per-row reason.
async fn duplicates(
    State(state): State<AppState>,
    session: Session,
    Query(q): Query<DuplicateQuery>,
) -> AppResult<Json<Vec<figure::Figure>>> {
    let viewer = auth::require_user_full(&session, &state.pool).await.ok();
    let exclude = viewer
        .as_ref()
        .map(|u| u.nsfw_visibility.as_str())
        .unwrap_or("hide")
        == "hide";
    let name = q.name.unwrap_or_default();
    let jan = q.jan.as_deref().map(str::trim).filter(|s| !s.is_empty());
    Ok(Json(
        figure::find_duplicates(&state.pool, &name, jan, exclude).await?,
    ))
}

#[derive(Debug, Deserialize)]
struct MatchQueryItem {
    name: String,
    #[serde(default)]
    manufacturer: Option<String>,
}

#[derive(Debug, Deserialize)]
struct MatchBody {
    queries: Vec<MatchQueryItem>,
}

/// Batch fuzzy-match free-text figure names against the catalogue (trigram).
/// Returns one result list per input query (top 3, best first), in the same
/// order. Powers the bulk wishlist importer's "% chance this already exists".
async fn match_figures(
    State(state): State<AppState>,
    session: Session,
    Json(body): Json<MatchBody>,
) -> AppResult<Json<Vec<Vec<figure::FigureMatch>>>> {
    let viewer = auth::require_user_full(&session, &state.pool).await.ok();
    let exclude = viewer
        .as_ref()
        .map(|u| u.nsfw_visibility.as_str())
        .unwrap_or("hide")
        == "hide";
    if body.queries.len() > 60 {
        return Err(AppError::BadRequest("too many queries (max 60)"));
    }
    let mut out = Vec::with_capacity(body.queries.len());
    for q in &body.queries {
        out.push(figure::match_one(&state.pool, &q.name, q.manufacturer.as_deref(), exclude).await?);
    }
    Ok(Json(out))
}

async fn list(
    State(state): State<AppState>,
    session: Session,
    Query(mut q): Query<figure::ListQuery>,
) -> AppResult<Json<Vec<figure::Figure>>> {
    // Resolve the viewer's NSFW preference. Anonymous viewers default to
    // hiding (same baseline as a fresh user). Admins still get the filter
    // applied to /api/figures — the dedicated /api/admin/figures route is
    // where moderators look at everything.
    let viewer = auth::require_user_full(&session, &state.pool).await.ok();
    let pref = viewer
        .as_ref()
        .map(|u| u.nsfw_visibility.as_str())
        .unwrap_or("hide");
    q.exclude_nsfw = pref == "hide";
    Ok(Json(figure::list(&state.pool, q).await?))
}

async fn create(
    State(state): State<AppState>,
    session: Session,
    Json(input): Json<NewFigure>,
) -> AppResult<(StatusCode, Json<figure::Figure>)> {
    let user_id = auth::require_user(&session).await?;
    let figure = figure::create(&state.pool, user_id, input).await?;
    tracing::info!(figure_id = %figure.id, created_by = %user_id, "figure created");
    Ok((StatusCode::CREATED, Json(figure)))
}

async fn get_one(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> AppResult<Json<figure::Figure>> {
    let f = figure::find_by_id(&state.pool, id)
        .await?
        .ok_or(AppError::NotFound)?;
    Ok(Json(f))
}

async fn patch_one(
    State(state): State<AppState>,
    session: Session,
    Path(id): Path<Uuid>,
    Json(input): Json<FigurePatch>,
) -> AppResult<Json<figure::Figure>> {
    let user = auth::require_user_full(&session, &state.pool).await?;
    let existing = figure::find_by_id(&state.pool, id)
        .await?
        .ok_or(AppError::NotFound)?;
    // Admins can edit anything; non-admins can only edit figures they created.
    let owner = existing.created_by == Some(user.id);
    if !user.is_admin && !owner {
        return Err(AppError::Forbidden);
    }
    let updated = figure::patch(&state.pool, id, input).await?;
    tracing::info!(
        figure_id = %updated.id,
        by_user = %user.id,
        as_admin = user.is_admin && !owner,
        "figure updated",
    );
    Ok(Json(updated))
}

async fn delete_one(
    State(state): State<AppState>,
    session: Session,
    Path(id): Path<Uuid>,
) -> AppResult<StatusCode> {
    let user = auth::require_user_full(&session, &state.pool).await?;
    let existing = figure::find_by_id(&state.pool, id)
        .await?
        .ok_or(AppError::NotFound)?;
    let owner = existing.created_by == Some(user.id);
    if !user.is_admin && !owner {
        return Err(AppError::Forbidden);
    }
    figure::delete(&state.pool, id).await?;
    tracing::info!(
        figure_id = %id,
        by_user = %user.id,
        as_admin = user.is_admin && !owner,
        "figure deleted",
    );
    Ok(StatusCode::NO_CONTENT)
}

/// Public list of figure types — used by the dropdown on the
/// add-figure / catalog filter UIs. Open to any signed-in user so the
/// dropdown populates without an admin call; the admin CRUD lives at
/// /admin/figure-types/*.
async fn list_figure_types(
    State(state): State<AppState>,
    session: tower_sessions::Session,
) -> AppResult<Json<Vec<figure_type::FigureType>>> {
    auth::require_user(&session).await?;
    Ok(Json(figure_type::list(&state.pool).await?))
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/figures", get(list).post(create))
        .route("/figures/duplicates", get(duplicates))
        .route("/figures/match", post(match_figures))
        .route(
            "/figures/{id}",
            get(get_one)
                .patch(patch_one)
                .delete(delete_one),
        )
        .route("/figure-types", get(list_figure_types))
}

//! `/api/figures/*` — figurine catalog (manual entry today; scraping in Phase 2B).

use crate::auth;
use crate::domain::figure::{self, FigurePatch, NewFigure};
use crate::domain::figure_price;
use crate::domain::figure_type;
use crate::domain::tags;
use crate::domain::visual_search;
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use axum::{
    Json, Router,
    extract::{Path, Query, State},
    http::StatusCode,
    response::Response,
    routing::{get, post},
};
use serde::Deserialize;
use std::time::Duration;
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
struct JanQuery {
    jan: Option<String>,
}

/// Exact catalogue lookup by JAN/EAN barcode — backs the camera scanner.
/// Returns the figure, or `null` when the barcode isn't in the catalogue.
async fn by_jan(
    State(state): State<AppState>,
    session: Session,
    Query(q): Query<JanQuery>,
) -> AppResult<Json<Option<figure::Figure>>> {
    // Gate NSFW catalogue hits behind the viewer's preference — the barcode
    // scan must not surface NSFW figures to a user who set `hide`.
    let user = auth::require_user_full(&session, &state.pool).await?;
    let exclude = user.nsfw_visibility == "hide";
    let jan = q
        .jan
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or(AppError::BadRequest("missing jan parameter"))?;
    Ok(Json(figure::find_by_jan(&state.pool, jan, exclude).await?))
}

#[derive(Debug, Deserialize)]
struct MatchQueryItem {
    name: String,
    #[serde(default)]
    manufacturer: Option<String>,
    /// Optional JAN/EAN barcode — when present an exact catalogue hit is
    /// prepended with score 1.0 (MFC CSV rows carry barcodes; orzgk doesn't).
    #[serde(default)]
    jan: Option<String>,
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
        let mut list =
            figure::match_one(&state.pool, &q.name, q.manufacturer.as_deref(), exclude).await?;
        // JAN is uniquely indexed — an exact barcode hit beats any trigram
        // score, so prepend it at 1.0 (deduped against the fuzzy results).
        if let Some(jan) = q.jan.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
            if let Some(f) = figure::find_by_jan(&state.pool, jan, exclude).await? {
                list.retain(|m| m.figure_id != f.id);
                list.insert(
                    0,
                    figure::FigureMatch {
                        figure_id: f.id,
                        name: f.name,
                        manufacturer_name: f.manufacturer_name,
                        score: 1.0,
                    },
                );
                list.truncate(3);
            }
        }
        out.push(list);
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

/// Popular appearance tags across the catalogue (busiest first, generic tags +
/// the long tail dropped) — drives the catalogue's tag picker. NSFW figures are
/// excluded from the facets; cached (10 min) since it scans the catalogue.
async fn list_tags(State(state): State<AppState>) -> AppResult<Response> {
    state
        .cache
        .json_cached("tag-facets", Duration::from_secs(600), || {
            tags::facets(&state.pool, 60)
        })
        .await
}

async fn create(
    State(state): State<AppState>,
    session: Session,
    Json(input): Json<NewFigure>,
) -> AppResult<(StatusCode, Json<figure::Figure>)> {
    let user_id = auth::require_user(&session).await?;
    let figure = figure::create(&state.pool, user_id, input).await?;
    tracing::info!(figure_id = %figure.id, created_by = %user_id, "figure created");
    // Keep the visual-search index current: queue this figure's images (its
    // official image now; any photos as they're uploaded). Best-effort + gated.
    visual_search::enqueue_figure_if_enabled(&state.pool, figure.id).await;
    Ok((StatusCode::CREATED, Json(figure)))
}

async fn get_one(
    State(state): State<AppState>,
    session: Session,
    Path(id): Path<Uuid>,
) -> AppResult<Json<figure::Figure>> {
    let f = figure::find_by_id(&state.pool, id)
        .await?
        .ok_or(AppError::NotFound)?;
    // NSFW gate, consistent with the list / entity paths: a viewer whose pref
    // is "hide" — the default for anonymous callers — can't pull an NSFW
    // figure's detail by id. Signed-in "blur"/"show" users still get it (the
    // SPA applies the blur), exactly as in their lists.
    if f.is_nsfw && viewer_hides_nsfw(&session, &state.pool).await {
        return Err(AppError::NotFound);
    }
    Ok(Json(f))
}

/// `true` when the request's viewer wants NSFW hidden — their `nsfw_visibility`
/// is "hide", or they're anonymous (the hide-by-default ceiling). Mirrors the
/// `nsfw_pref` logic the list/entity routes use. Shared with the visual-search
/// "similar" rail so it filters NSFW for hide-viewers the same way.
pub(crate) async fn viewer_hides_nsfw(session: &Session, pool: &sqlx::PgPool) -> bool {
    auth::require_user_full(session, pool)
        .await
        .ok()
        .map(|u| u.nsfw_visibility.as_str() == "hide")
        .unwrap_or(true)
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
    // If the official image URL changed, forget the OLD one's index + queue entry
    // (image_ref is the URL itself — no FK to cascade), then enqueue the new one.
    // Otherwise a stale embedding for the replaced URL would linger.
    if let Some(old) = existing.official_image_url.as_deref() {
        if !old.is_empty() && updated.official_image_url.as_deref() != Some(old) {
            visual_search::forget_image(&state.pool, old).await;
        }
    }
    // A by-hand appearance-tags edit → re-embed the figure's tagvec so the
    // "Description" search reflects it (gated; the auto-tagger won't overwrite it).
    if updated.visual_tags != existing.visual_tags {
        visual_search::requeue_tagvec_if_enabled(&state.pool, updated.id).await;
    }
    visual_search::enqueue_figure_if_enabled(&state.pool, updated.id).await;
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
    let storage_keys = figure::delete(&state.pool, id).await?;
    // Photo blobs don't cascade with the row — drop them so they don't leak.
    for key in &storage_keys {
        if let Err(e) = state.storage.delete(key).await {
            tracing::warn!(error = ?e, storage_key = %key, "failed to delete figure photo blob on figure delete");
        }
    }
    tracing::info!(
        figure_id = %id,
        by_user = %user.id,
        as_admin = user.is_admin && !owner,
        photos = storage_keys.len(),
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

/// Market-price history for one figure, oldest first — feeds the sparkline +
/// "évolution" dialog on the figure page. Open to any signed-in user (the
/// catalog price history isn't per-user data).
async fn price_history(
    State(state): State<AppState>,
    session: Session,
    Path(id): Path<Uuid>,
) -> AppResult<Json<Vec<figure_price::PricePoint>>> {
    auth::require_user(&session).await?;
    Ok(Json(
        figure_price::history_for_figure(&state.pool, id).await?,
    ))
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/figures", get(list).post(create))
        .route("/figures/duplicates", get(duplicates))
        .route("/figures/by-jan", get(by_jan))
        .route("/figures/tags", get(list_tags))
        .route("/figures/match", post(match_figures))
        .route(
            "/figures/{id}",
            get(get_one)
                .patch(patch_one)
                .delete(delete_one),
        )
        .route("/figures/{id}/price-history", get(price_history))
        .route("/figure-types", get(list_figure_types))
}

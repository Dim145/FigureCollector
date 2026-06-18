//! `/api/visual-search/status` + `/api/me/visual-search` — photo (visual)
//! search.
//!
//! The query embedding is produced in the browser (DINOv2-small via
//! transformers.js); we receive only the 384-d vector, run the pgvector ANN
//! over the catalog index, and return ranked candidate figures the user then
//! confirms. Gated by the admin `visual_search` toggle. The photo itself never
//! reaches the server for this path — only its embedding does.

use std::collections::HashMap;

use axum::{
    Json, Router,
    extract::{Path, State},
    routing::{get, post},
};
use base64::Engine as _;
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use tower_sessions::Session;
use uuid::Uuid;

use crate::domain::{clustering, figure, settings, visual_search, worker};
use crate::external::vision;
use crate::{
    auth,
    error::{AppError, AppResult},
    state::AppState,
};

/// How many candidate figures to return for one photo.
const TOP_K: i64 = 12;

/// How many neighbours the "figurines proches" rail shows on a figure page —
/// one tidy row on the widest grid (lg = 4 across). No skip there, so this is
/// exactly what's displayed.
const SIMILAR_K: i64 = 4;

/// Recommendation pool size — the collection rail shows 4 at a time but the
/// client lets you "skip" through the rest, so we hand it a deeper pool.
const RECO_K: i64 = 12;

/// Convert the admin similarity-% floor into a max cosine distance: 75 % →
/// 0.25 (only matches at least that similar surface). 0 % keeps everything,
/// 100 % keeps only (near-)identical.
async fn max_distance_for_threshold(pool: &PgPool) -> AppResult<f64> {
    let pct = settings::visual_search_similarity_threshold(pool).await?;
    Ok((1.0 - pct / 100.0).clamp(0.0, 2.0))
}

/// Decoded-image cap (bytes) for the external fallback. The client downscales
/// to ~1024 px JPEG (far under this); the cap is a defensive backstop against a
/// hand-crafted oversized payload before we forward it to a paid API.
const MAX_EXTERNAL_IMAGE_BYTES: usize = 6 * 1024 * 1024;

#[derive(Deserialize)]
struct SearchInput {
    /// 384-d L2-normalised DINOv2-small embedding of the user's photo.
    embedding: Vec<f32>,
}

#[derive(Serialize)]
struct ScoredFigure {
    /// Cosine distance (0 = identical) — lower is a closer match.
    distance: f32,
    figure: figure::Figure,
}

async fn search_by_image(
    State(state): State<AppState>,
    session: Session,
    Json(input): Json<SearchInput>,
) -> AppResult<Json<Vec<ScoredFigure>>> {
    auth::require_user(&session).await?;
    if !settings::visual_search_enabled(&state.pool).await? {
        return Err(AppError::FeatureDisabled("visual search is not enabled"));
    }
    // Search is an *active* query (the user took a photo), so we keep NSFW
    // matches and let the client blur per pref — a hide-viewer may well be
    // identifying an adult figure they own.
    let candidates =
        visual_search::search(&state.pool, input.embedding, visual_search::MODEL_VERSION, TOP_K)
            .await?;
    Ok(Json(hydrate(&state.pool, candidates, false).await?))
}

#[derive(Deserialize)]
struct TextSearchInput {
    /// 384-d L2-normalised multilingual-e5-small embedding of the query text
    /// (the client prefixes the query with "query: " before embedding).
    embedding: Vec<f32>,
}

/// `POST /me/text-search` — semantic text search. The query is embedded
/// in-browser (e5-small) and we run the same pgvector ANN, filtered to the text
/// model. Gated on the `text_search` admin toggle.
async fn text_search(
    State(state): State<AppState>,
    session: Session,
    Json(input): Json<TextSearchInput>,
) -> AppResult<Json<Vec<ScoredFigure>>> {
    auth::require_user(&session).await?;
    if !settings::text_search_enabled(&state.pool).await? {
        return Err(AppError::FeatureDisabled("text search is not enabled"));
    }
    let mut candidates = visual_search::search(
        &state.pool,
        input.embedding,
        visual_search::TEXT_MODEL_VERSION,
        TOP_K,
    )
    .await?;
    // Admin-tunable match floor: drop hits below the min-match %. e5 compresses
    // cosine similarity into a high band, so this mainly trims the weak tail.
    // Default 0 % → max_distance 1.0 → keeps every top-K hit.
    let max_distance = 1.0 - settings::text_search_min_match(&state.pool).await? / 100.0;
    candidates.retain(|c| f64::from(c.distance) <= max_distance);
    // Semantic search lives in the catalogue's search box, so it honours the
    // viewer's NSFW pref exactly like the keyword list (`figures::list` sets
    // `exclude_nsfw = pref == "hide"`): a hide-viewer never receives adult
    // matches — toggling "Sens" must not surface what keyword search hides —
    // while blur-viewers get them and the client blurs per pref.
    let exclude_nsfw = crate::routes::figures::viewer_hides_nsfw(&session, &state.pool).await;
    Ok(Json(hydrate(&state.pool, candidates, exclude_nsfw).await?))
}

/// Hydrate distance-ranked candidates into full catalog cards, preserving the
/// ANN ordering. `exclude_nsfw` drops adult figures for a hide-viewer (passive
/// surfaces); when kept, they ride along and the client blurs per pref.
async fn hydrate(
    pool: &PgPool,
    candidates: Vec<visual_search::Candidate>,
    exclude_nsfw: bool,
) -> AppResult<Vec<ScoredFigure>> {
    if candidates.is_empty() {
        return Ok(Vec::new());
    }
    let ids: Vec<Uuid> = candidates.iter().map(|c| c.figure_id).collect();
    let figures = figure::by_ids(pool, &ids, exclude_nsfw).await?;
    let mut by_id: HashMap<Uuid, figure::Figure> =
        figures.into_iter().map(|f| (f.id, f)).collect();
    Ok(candidates
        .into_iter()
        .filter_map(|c| {
            by_id
                .remove(&c.figure_id)
                .map(|figure| ScoredFigure { distance: c.distance, figure })
        })
        .collect())
}

/// `GET /figures/{id}/similar` — the "figurines proches" rail. Seeds the ANN
/// from the figure's own image embeddings and returns its nearest catalog
/// neighbours. Returns 200 `[]` when the figure isn't on the index yet (no
/// embeddings), so the client just hides the rail.
async fn similar_figures(
    State(state): State<AppState>,
    session: Session,
    Path(figure_id): Path<Uuid>,
) -> AppResult<Json<Vec<ScoredFigure>>> {
    auth::require_user(&session).await?;
    if !settings::visual_search_enabled(&state.pool).await? {
        return Err(AppError::FeatureDisabled("visual search is not enabled"));
    }
    let max_distance = max_distance_for_threshold(&state.pool).await?;
    let candidates = visual_search::similar_figures(
        &state.pool,
        figure_id,
        visual_search::MODEL_VERSION,
        SIMILAR_K,
        max_distance,
    )
    .await?;
    // Passive discovery rail → honour the viewer's NSFW pref: a hide-viewer
    // never receives adult neighbours (the catalogue lists filter the same way).
    let exclude_nsfw = crate::routes::figures::viewer_hides_nsfw(&session, &state.pool).await;
    Ok(Json(hydrate(&state.pool, candidates, exclude_nsfw).await?))
}

/// `GET /me/recommendations` — the "reco par goût" rail. Nearest catalogue
/// figures to what the user owns, minus what they already own or wishlist.
/// Returns 200 `[]` when they own nothing on the index (the client hides the
/// rail). Honours the viewer's NSFW pref like the catalogue lists.
async fn recommendations(
    State(state): State<AppState>,
    session: Session,
) -> AppResult<Json<Vec<ScoredFigure>>> {
    let user_id = auth::require_user(&session).await?;
    if !settings::visual_search_enabled(&state.pool).await? {
        return Err(AppError::FeatureDisabled("visual search is not enabled"));
    }
    let max_distance = max_distance_for_threshold(&state.pool).await?;
    let candidates = visual_search::recommendations(
        &state.pool,
        user_id,
        visual_search::MODEL_VERSION,
        RECO_K,
        max_distance,
    )
    .await?;
    let exclude_nsfw = crate::routes::figures::viewer_hides_nsfw(&session, &state.pool).await;
    Ok(Json(hydrate(&state.pool, candidates, exclude_nsfw).await?))
}

#[derive(Serialize)]
struct Status {
    /// Admin toggle.
    enabled: bool,
    /// The model the client must load so its vectors match the catalog index.
    model_version: String,
    embedded: i64,
    pending: i64,
    /// At least one catalog image is embedded → a search can return matches.
    ready: bool,
    /// A live worker advertises the `embed` capability (can build the index).
    worker_present: bool,
    /// The opt-in external (Google Vision) fallback is available: parent flag
    /// on + admin toggle on + API key set. Drives the "search elsewhere"
    /// affordance shown after an empty in-catalog result.
    external_enabled: bool,
    /// Admin opt-in for the "browse par ambiance" clustering view (off by
    /// default). Drives whether the catalogue offers the Ambiances toggle.
    ambiances: bool,
    /// Admin opt-in for semantic text search (off by default). Drives the
    /// catalogue's "Sens" search-mode toggle.
    text_search_enabled: bool,
    /// The text model the client must load so its query vectors match the index.
    text_model_version: String,
    /// At least one figure's text is embedded → semantic search can return hits.
    text_ready: bool,
    text_embedded: i64,
}

async fn status(State(state): State<AppState>, session: Session) -> AppResult<Json<Status>> {
    auth::require_user(&session).await?;
    let enabled = settings::visual_search_enabled(&state.pool).await?;
    let stats = visual_search::index_stats(&state.pool, visual_search::MODEL_VERSION).await?;
    let worker_present = worker::any_live_with_capability(&state.pool, "embed").await?;
    let external_enabled = settings::visual_search_external_ready(&state.pool).await?;
    let ambiances = settings::visual_search_ambiances_enabled(&state.pool).await?;
    let text_search_enabled = settings::text_search_enabled(&state.pool).await?;
    let text_stats =
        visual_search::index_stats(&state.pool, visual_search::TEXT_MODEL_VERSION).await?;
    Ok(Json(Status {
        enabled,
        model_version: visual_search::MODEL_VERSION.to_string(),
        embedded: stats.embedded,
        pending: stats.pending,
        ready: stats.embedded > 0,
        worker_present,
        external_enabled,
        ambiances,
        text_search_enabled,
        text_model_version: visual_search::TEXT_MODEL_VERSION.to_string(),
        text_ready: text_stats.embedded > 0,
        text_embedded: text_stats.embedded,
    }))
}

#[derive(Deserialize)]
struct ExternalInput {
    /// Base64-encoded JPEG/PNG of the photo (optionally a `data:…;base64,`
    /// URL). Downscaled client-side before it leaves the device.
    image_base64: String,
}

/// `POST /me/visual-search/external` — the opt-in off-device fallback.
///
/// THIS is the only photo-search path where the image leaves the device: it's
/// forwarded to Google Vision Web Detection. Gated three ways (parent flag +
/// external toggle + key), and the client only calls it after an explicit
/// user consent following an empty in-catalog result.
async fn external_search(
    State(state): State<AppState>,
    session: Session,
    Json(input): Json<ExternalInput>,
) -> AppResult<Json<vision::WebHints>> {
    auth::require_user(&session).await?;
    if !settings::visual_search_external_ready(&state.pool).await? {
        return Err(AppError::FeatureDisabled("external image search is not enabled"));
    }
    let api_key = settings::visual_search_external_api_key(&state.pool)
        .await?
        .ok_or(AppError::FeatureDisabled("external image search is not configured"))?;
    // Tolerate an optional `data:image/…;base64,` prefix (comma isn't in the
    // base64 alphabet, so the last comma-split segment is the payload).
    let b64 = input
        .image_base64
        .rsplit(',')
        .next()
        .unwrap_or(&input.image_base64)
        .trim();
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(b64)
        .map_err(|_| AppError::BadRequest("image_base64 is not valid base64"))?;
    if bytes.is_empty() {
        return Err(AppError::BadRequest("empty image"));
    }
    if bytes.len() > MAX_EXTERNAL_IMAGE_BYTES {
        return Err(AppError::BadRequest("image too large"));
    }
    let hints = vision::web_detection(&state.http, &api_key, &bytes).await?;
    tracing::info!(
        entities = hints.entities.len(),
        pages = hints.pages.len(),
        has_best_guess = hints.best_guess.is_some(),
        "external image search performed"
    );
    Ok(Json(hints))
}

#[derive(Serialize)]
struct AmbianceCluster {
    /// Display order index (clusters are returned largest-first).
    id: usize,
    /// Most common figure_type slug in the cluster — the client maps it to the
    /// kanji/label. `None` only if every member somehow lacks a type.
    dominant_type: Option<String>,
    /// Visible member count, after the viewer's NSFW filter.
    count: usize,
    /// Visible member ids, closest-to-centroid first — the client filters the
    /// catalogue grid to these when the ambiance is opened.
    member_ids: Vec<Uuid>,
    /// Up to 4 hydrated representatives (closest to centroid) for the mosaic.
    representatives: Vec<figure::Figure>,
}

/// `GET /visual-search/clusters` — the "browse par ambiance" view: the
/// catalogue grouped into visual-style clusters (DINOv2 k-means). Honours the
/// viewer's NSFW pref (hide → adult members dropped, empty clusters omitted).
async fn ambiance_clusters(
    State(state): State<AppState>,
    session: Session,
) -> AppResult<Json<Vec<AmbianceCluster>>> {
    auth::require_user(&session).await?;
    if !settings::visual_search_enabled(&state.pool).await? {
        return Err(AppError::FeatureDisabled("visual search is not enabled"));
    }
    if !settings::visual_search_ambiances_enabled(&state.pool).await? {
        return Err(AppError::FeatureDisabled("ambiances are not enabled"));
    }
    let exclude_nsfw = crate::routes::figures::viewer_hides_nsfw(&session, &state.pool).await;
    let raw = clustering::clusters(&state.pool, visual_search::MODEL_VERSION).await?;

    // Per cluster: keep the visible members (in centroid order), derive the
    // dominant type, and pick the first 4 as mosaic representatives.
    struct Pending {
        dominant_type: Option<String>,
        member_ids: Vec<Uuid>,
        rep_ids: Vec<Uuid>,
    }
    let mut pending: Vec<Pending> = Vec::new();
    for c in &raw {
        let visible: Vec<&clustering::MemberMeta> = c
            .members
            .iter()
            .filter(|m| !(exclude_nsfw && m.is_nsfw))
            .collect();
        if visible.is_empty() {
            continue;
        }
        let mut type_counts: HashMap<&str, usize> = HashMap::new();
        for m in &visible {
            *type_counts.entry(m.figure_type.as_str()).or_insert(0) += 1;
        }
        let dominant_type = type_counts
            .into_iter()
            .max_by_key(|(_, n)| *n)
            .map(|(t, _)| t.to_string());
        let member_ids: Vec<Uuid> = visible.iter().map(|m| m.id).collect();
        let rep_ids = member_ids.iter().take(4).copied().collect();
        pending.push(Pending {
            dominant_type,
            member_ids,
            rep_ids,
        });
    }
    // Largest ambiances first.
    pending.sort_by(|a, b| b.member_ids.len().cmp(&a.member_ids.len()));

    // Hydrate every representative across clusters in one query.
    let all_rep_ids: Vec<Uuid> = pending.iter().flat_map(|p| p.rep_ids.iter().copied()).collect();
    let figures = figure::by_ids(&state.pool, &all_rep_ids, exclude_nsfw).await?;
    let by_id: HashMap<Uuid, figure::Figure> = figures.into_iter().map(|f| (f.id, f)).collect();

    let out = pending
        .into_iter()
        .enumerate()
        .map(|(id, p)| AmbianceCluster {
            id,
            dominant_type: p.dominant_type,
            count: p.member_ids.len(),
            representatives: p
                .rep_ids
                .iter()
                .filter_map(|rid| by_id.get(rid).cloned())
                .collect(),
            member_ids: p.member_ids,
        })
        .collect();
    Ok(Json(out))
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/visual-search/status", get(status))
        .route("/me/visual-search", post(search_by_image))
        .route("/me/text-search", post(text_search))
        .route("/me/recommendations", get(recommendations))
        .route("/figures/{id}/similar", get(similar_figures))
        .route("/visual-search/clusters", get(ambiance_clusters))
}

/// The external fallback is split into its own router so it can carry an image
/// payload (a larger body limit) and a tighter rate limit (it hits a paid API)
/// without loosening the tiny internal-search route. Mounted in `routes::mod`.
pub fn external_router() -> Router<AppState> {
    Router::new().route("/me/visual-search/external", post(external_search))
}

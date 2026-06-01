//! MangaCollector synergy.
//!
//! Two surfaces:
//!   * `/api/me/manga-link*` — owner-only (require_user / require_user_full):
//!     read / set / clear the link to the user's MangaCollector instance, and
//!     read the computed cross-links (series they both read + own, figures to
//!     buy for series they read, and the per-figure "you're at X% in the
//!     manga" badge).
//!   * `/api/public/figures/by-mal/{mal_id}` — **anonymous**: the reverse
//!     direction, so a MangaCollector instance (or anyone) can ask "which
//!     figures exist for this MAL series?". SFW by default; `?nsfw=1` opts in.
//!
//! Every outbound call to the user's MangaCollector instance goes through the
//! SSRF-guarded, 24h-cached `domain::manga::fetch_profile`, using the
//! no-redirect HTTP client so a validated URL can't be bounced to an internal
//! host via a 30x.

use crate::auth;
use crate::domain::manga;
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use axum::{
    Json, Router,
    extract::{Path, Query, State},
    http::StatusCode,
    routing::get,
};
use serde::{Deserialize, Serialize};
use tower_sessions::Session;
use uuid::Uuid;

// ── Owner side ────────────────────────────────────────────────────────────────

/// Lightweight profile summary echoed back on the link-status / connect calls.
#[derive(Serialize)]
struct ProfileSummary {
    display_name: String,
    series_count: i64,
    volumes_owned: i64,
}

impl From<&manga::MangaProfile> for ProfileSummary {
    fn from(p: &manga::MangaProfile) -> Self {
        Self {
            display_name: p.display_name.clone(),
            series_count: p.series_count(),
            volumes_owned: p.volumes_owned_total(),
        }
    }
}

#[derive(Serialize)]
struct LinkStatus {
    connected: bool,
    base_url: Option<String>,
    slug: Option<String>,
    /// `None` when not connected, or when connected but the instance couldn't
    /// be reached right now (we don't fail the whole call for that).
    profile: Option<ProfileSummary>,
}

async fn get_link(State(state): State<AppState>, session: Session) -> AppResult<Json<LinkStatus>> {
    let user_id = auth::require_user(&session).await?;
    let (base_url, slug) = manga::get_config(&state.pool, user_id).await?;
    let connected = base_url.is_some() && slug.is_some();

    // Best-effort profile fetch: a transient instance outage must not 500 the
    // status endpoint, so on error we return connected:true, profile:null.
    let profile = match (connected, &base_url, &slug) {
        (true, Some(b), Some(s)) => {
            match manga::fetch_profile(&state.pool, &state.http_no_redirect, b, s).await {
                Ok(p) => Some(ProfileSummary::from(&p)),
                Err(e) => {
                    tracing::debug!(error = %e, "manga profile fetch failed on status read");
                    None
                }
            }
        }
        _ => None,
    };

    Ok(Json(LinkStatus {
        connected,
        base_url,
        slug,
        profile,
    }))
}

#[derive(Deserialize)]
struct SetLinkBody {
    base_url: String,
    slug: String,
}

#[derive(Serialize)]
struct SetLinkResult {
    connected: bool,
    profile: ProfileSummary,
}

async fn set_link(
    State(state): State<AppState>,
    session: Session,
    Json(body): Json<SetLinkBody>,
) -> AppResult<Json<SetLinkResult>> {
    let user_id = auth::require_user(&session).await?;
    let base_url = body.base_url.trim();
    let slug = body.slug.trim();
    if base_url.is_empty() || slug.is_empty() {
        return Err(AppError::BadRequest("base_url and slug are required"));
    }

    // Test the connection before persisting — this runs the SSRF guard and the
    // actual fetch, so a save only succeeds for a reachable, allowed instance.
    // Any failure propagates (BadRequest / ServiceUnavailable) so the UI can
    // say "couldn't connect".
    let profile = manga::fetch_profile(&state.pool, &state.http_no_redirect, base_url, slug).await?;
    manga::set_config(&state.pool, user_id, base_url, slug).await?;

    Ok(Json(SetLinkResult {
        connected: true,
        profile: ProfileSummary::from(&profile),
    }))
}

async fn delete_link(
    State(state): State<AppState>,
    session: Session,
) -> AppResult<StatusCode> {
    let user_id = auth::require_user(&session).await?;
    manga::clear_config(&state.pool, user_id).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn get_crossings(
    State(state): State<AppState>,
    session: Session,
) -> AppResult<Json<manga::Crossings>> {
    let user = auth::require_user_full(&session, &state.pool).await?;
    let exclude_nsfw = user.nsfw_visibility == "hide";
    let crossings =
        manga::crossings(&state.pool, &state.http_no_redirect, user.id, exclude_nsfw).await?;
    Ok(Json(crossings))
}

#[derive(Serialize)]
struct FigureLinkResult {
    in_library: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    read_percent: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    volumes_owned: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    volumes: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    fully_read: Option<bool>,
}

async fn get_figure_link(
    State(state): State<AppState>,
    session: Session,
    Path(figure_id): Path<Uuid>,
) -> AppResult<Json<FigureLinkResult>> {
    let user = auth::require_user_full(&session, &state.pool).await?;
    let link = manga::figure_manga_link(&state.pool, &state.http_no_redirect, user.id, figure_id)
        .await?;
    Ok(Json(match link {
        Some(e) => FigureLinkResult {
            in_library: true,
            name: Some(e.name),
            read_percent: e.read_percent,
            volumes_owned: e.volumes_owned,
            volumes: e.volumes,
            fully_read: e.fully_read,
        },
        None => FigureLinkResult {
            in_library: false,
            name: None,
            read_percent: None,
            volumes_owned: None,
            volumes: None,
            fully_read: None,
        },
    }))
}

// ── Public side (anonymous) ───────────────────────────────────────────────────

#[derive(Deserialize)]
struct ByMalQuery {
    /// Anonymous NSFW opt-in. SFW by default; only `nsfw=1` includes NSFW
    /// figures. Matches the convention used by the public gift-list surface.
    #[serde(default)]
    nsfw: Option<String>,
}

#[derive(Serialize)]
struct ByMalResult {
    mal_id: i32,
    count: usize,
    figures: Vec<manga::FigureRef>,
}

async fn figures_by_mal(
    State(state): State<AppState>,
    Path(mal_id): Path<i32>,
    Query(q): Query<ByMalQuery>,
) -> AppResult<Json<ByMalResult>> {
    let exclude_nsfw = q.nsfw.as_deref() != Some("1");
    let figures = manga::figures_by_mal(&state.pool, mal_id, exclude_nsfw).await?;
    Ok(Json(ByMalResult {
        mal_id,
        count: figures.len(),
        figures,
    }))
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/me/manga-link",
            get(get_link).put(set_link).delete(delete_link),
        )
        .route("/me/manga-link/crossings", get(get_crossings))
        .route("/me/manga-link/figure/{figure_id}", get(get_figure_link))
        .route("/public/figures/by-mal/{mal_id}", get(figures_by_mal))
}

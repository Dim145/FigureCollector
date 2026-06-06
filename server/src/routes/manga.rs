//! MangaCollector synergy.
//!
//! Surfaces:
//!   * `/api/manga-servers` — owner-only: the admin-approved servers a user can
//!     pick from when linking (the registry's `approved` rows).
//!   * `/api/me/manga-link*` — owner-only (require_user / require_user_full):
//!     read / set / clear the link, and read the computed cross-links. A link is
//!     `(manga_server_id, slug)`; its live status comes from the server's
//!     registry status (`pending` → awaiting an admin, `approved` → active,
//!     `revoked` → disabled). Crossings + the per-figure badge only resolve for
//!     an `approved` server.
//!   * `/api/public/figures/by-mal/{mal_id}` — **anonymous**: the reverse
//!     direction. SFW by default; `?nsfw=1` opts in.
//!
//! Every outbound call to a MangaCollector instance goes through the
//! SSRF-guarded, 24h-cached `domain::manga::fetch_profile` over the no-redirect
//! HTTP client. Submitting a new server SSRF-validates the origin up front, so a
//! private/loopback target never even reaches the registry.

use crate::auth;
use crate::domain::{manga, manga_servers};
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use axum::{
    Json, Router,
    extract::{Path, Query, State},
    http::StatusCode,
    routing::{get, post},
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

/// The server a link points at, as echoed in the status payload.
#[derive(Serialize)]
struct LinkServerInfo {
    id: Uuid,
    base_url: String,
    label: Option<String>,
}

#[derive(Serialize)]
struct LinkStatus {
    /// Whether the user has a link at all (any status). The SPA shows the
    /// connected card vs. the picker off this; it drives feature activation off
    /// `status` instead.
    connected: bool,
    /// `"pending" | "approved" | "revoked"`, or `None` when unlinked.
    status: Option<String>,
    server: Option<LinkServerInfo>,
    slug: Option<String>,
    /// Only populated for an `approved` server that was reachable just now.
    profile: Option<ProfileSummary>,
    /// The admin's revocation reason, surfaced only when `status == "revoked"`.
    #[serde(skip_serializing_if = "Option::is_none")]
    revoked_reason: Option<String>,
}

/// `GET /api/manga-servers` — the approved servers a user can pick from.
async fn list_servers(
    State(state): State<AppState>,
    session: Session,
) -> AppResult<Json<Vec<manga_servers::MangaServerOption>>> {
    auth::require_user(&session).await?;
    Ok(Json(manga_servers::list_approved(&state.pool).await?))
}

async fn get_link(State(state): State<AppState>, session: Session) -> AppResult<Json<LinkStatus>> {
    let user_id = auth::require_user(&session).await?;

    let Some(link) = manga_servers::get_link(&state.pool, user_id).await? else {
        return Ok(Json(LinkStatus {
            connected: false,
            status: None,
            server: None,
            slug: None,
            profile: None,
            revoked_reason: None,
        }));
    };

    // Best-effort profile, only for an approved server: a transient outage must
    // not 500 the status read, and we never fetch a pending/revoked instance.
    let profile = if link.is_approved() {
        match manga::fetch_profile(&state.pool, &state.http_no_redirect, &link.base_url, &link.slug)
            .await
        {
            Ok(p) => Some(ProfileSummary::from(&p)),
            Err(e) => {
                tracing::debug!(error = %e, "manga profile fetch failed on status read");
                None
            }
        }
    } else {
        None
    };

    let revoked_reason = (link.status == manga_servers::STATUS_REVOKED)
        .then(|| link.note.clone())
        .flatten();

    Ok(Json(LinkStatus {
        connected: true,
        status: Some(link.status.clone()),
        server: Some(LinkServerInfo {
            id: link.server_id,
            base_url: link.base_url.clone(),
            label: link.label.clone(),
        }),
        slug: Some(link.slug.clone()),
        profile,
        revoked_reason,
    }))
}

/// Either pick an approved server by id, or submit a new one by URL — plus the
/// public slug. Exactly one of `server_id` / `new_base_url` is expected.
#[derive(Deserialize)]
struct SetLinkBody {
    #[serde(default)]
    server_id: Option<Uuid>,
    #[serde(default)]
    new_base_url: Option<String>,
    slug: String,
}

#[derive(Serialize)]
struct SetLinkResult {
    connected: bool,
    /// `"approved"` (active immediately) or `"pending"` (awaiting an admin).
    status: String,
    profile: Option<ProfileSummary>,
}

async fn set_link(
    State(state): State<AppState>,
    session: Session,
    Json(body): Json<SetLinkBody>,
) -> AppResult<Json<SetLinkResult>> {
    let user_id = auth::require_user(&session).await?;
    let slug = body.slug.trim();
    if slug.is_empty() {
        return Err(AppError::BadRequest("slug is required"));
    }

    // Resolve the target server from the registry.
    let new_url = body.new_base_url.as_deref().map(str::trim).filter(|s| !s.is_empty());
    let server = match (body.server_id, new_url) {
        // Pick an existing server — it must be approved.
        (Some(id), _) => {
            let s = manga_servers::find_by_id(&state.pool, id)
                .await?
                .ok_or(AppError::NotFound)?;
            if s.status != manga_servers::STATUS_APPROVED {
                return Err(AppError::BadRequest("that server isn't available"));
            }
            s
        }
        // Submit (or resolve an existing) server by URL.
        (None, Some(url)) => {
            let s = manga_servers::submit(&state.pool, user_id, url).await?;
            if s.status == manga_servers::STATUS_REVOKED {
                return Err(AppError::BadRequest("that server has been revoked"));
            }
            s
        }
        (None, None) => {
            return Err(AppError::BadRequest("server_id or new_base_url is required"));
        }
    };

    if server.status == manga_servers::STATUS_APPROVED {
        // Test-fetch before persisting so a bad slug / dead instance surfaces as
        // an error instead of a silently-broken link.
        let profile =
            manga::fetch_profile(&state.pool, &state.http_no_redirect, &server.base_url, slug)
                .await?;
        manga_servers::set_link(&state.pool, user_id, server.id, slug).await?;
        Ok(Json(SetLinkResult {
            connected: true,
            status: server.status,
            profile: Some(ProfileSummary::from(&profile)),
        }))
    } else {
        // pending — persist the link but don't fetch an unapproved instance.
        manga_servers::set_link(&state.pool, user_id, server.id, slug).await?;
        Ok(Json(SetLinkResult {
            connected: true,
            status: server.status,
            profile: None,
        }))
    }
}

async fn delete_link(State(state): State<AppState>, session: Session) -> AppResult<StatusCode> {
    let user_id = auth::require_user(&session).await?;
    manga_servers::clear_link(&state.pool, user_id).await?;
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
    /// The matched manga's MAL id — lets the badge deep-link to the manga page
    /// (`{base}/mangapage?mal_id=`) instead of the bare public profile.
    #[serde(skip_serializing_if = "Option::is_none")]
    mal_id: Option<i32>,
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
    let link =
        manga::figure_manga_link(&state.pool, &state.http_no_redirect, user.id, figure_id).await?;
    Ok(Json(match link {
        Some(e) => FigureLinkResult {
            in_library: true,
            mal_id: e.mal_id,
            name: Some(e.name),
            read_percent: e.read_percent,
            volumes_owned: e.volumes_owned,
            volumes: e.volumes,
            fully_read: e.fully_read,
        },
        None => FigureLinkResult {
            in_library: false,
            mal_id: None,
            name: None,
            read_percent: None,
            volumes_owned: None,
            volumes: None,
            fully_read: None,
        },
    }))
}

#[derive(Serialize)]
struct SeriesLinkResult {
    in_library: bool,
    /// The matched manga's MAL id, when the series is in the user's library —
    /// the series page deep-links to `{base}/mangapage?mal_id=` with it.
    #[serde(skip_serializing_if = "Option::is_none")]
    mal_id: Option<i32>,
}

/// `GET /api/me/manga-link/series/{series_id}` — does the signed-in user read
/// this series on the manga side? Returns the matched MAL id so the series page
/// can offer an "open in MangaCollector" button. Owner-only; resolves to
/// `in_library: false` for an unlinked / pending / revoked link or no match.
async fn get_series_link(
    State(state): State<AppState>,
    session: Session,
    Path(series_id): Path<Uuid>,
) -> AppResult<Json<SeriesLinkResult>> {
    let user_id = auth::require_user(&session).await?;
    let mal_id =
        manga::series_manga_link(&state.pool, &state.http_no_redirect, user_id, series_id).await?;
    Ok(Json(SeriesLinkResult {
        in_library: mal_id.is_some(),
        mal_id,
    }))
}

#[derive(Serialize)]
struct SyncResult {
    /// How many of the user's series got a (real) manga MAL id this run.
    backfilled: u32,
}

/// `POST /api/me/manga-link/sync` — recompute the crossings *now* instead of
/// waiting on the 24h profile cache / the daily backfill. Resolves the manga-side
/// MAL id for the series in the user's own collection (via AniList relations),
/// and force-refreshes their cached MangaCollector profile. Owner-only; a
/// no-op-safe success when unlinked.
async fn sync_link(State(state): State<AppState>, session: Session) -> AppResult<Json<SyncResult>> {
    let user_id = auth::require_user(&session).await?;
    // (1) Fill series.manga_mal_id for the user's owned series (the dual side).
    let backfilled = manga::backfill_manga_mal(&state.pool, &state.http, 500, Some(user_id))
        .await
        .unwrap_or(0);
    // (2) Drop the 24h profile cache so the next crossings read pulls a fresh
    //     library — only for an approved, reachable link.
    if let Some(link) = manga_servers::get_link(&state.pool, user_id).await? {
        if link.is_approved() {
            let _ = manga::refresh_profile(
                &state.pool,
                &state.http_no_redirect,
                &link.base_url,
                &link.slug,
            )
            .await;
        }
    }
    Ok(Json(SyncResult { backfilled }))
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
        .route("/manga-servers", get(list_servers))
        .route(
            "/me/manga-link",
            get(get_link).put(set_link).delete(delete_link),
        )
        .route("/me/manga-link/crossings", get(get_crossings))
        .route("/me/manga-link/sync", post(sync_link))
        .route("/me/manga-link/figure/{figure_id}", get(get_figure_link))
        .route("/me/manga-link/series/{series_id}", get(get_series_link))
        .route("/public/figures/by-mal/{mal_id}", get(figures_by_mal))
}

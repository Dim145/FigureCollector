//! MangaCollector synergy.
//!
//! A user links their own [MangaCollector](https://github.com/Dim145/MangaCollector)
//! instance by **base URL + public-profile slug**. FC then reads their public
//! manga library server-side (`GET {base}/api/public/u/{slug}`) and joins it to
//! the FC catalogue by **MAL id** — both sides store one, so a manga series and
//! a figurine series line up without any manual mapping.
//!
//! Three things make this safe to expose:
//!   * The fetch is **SSRF-guarded** — the composed URL runs through
//!     `external::notify_channel::validate_outbound_url` (resolves DNS, rejects
//!     loopback / private / link-local / CGNAT / ULA / metadata IPs, http(s)
//!     only) BEFORE the request is built, and the request itself goes through
//!     `state.http_no_redirect` so a 30x can't bounce us to an internal host
//!     after the check. This reuses the exact guard the webhook/ntfy adapters
//!     use — it is *not* duplicated here.
//!   * The profile is **cached 24h** in `external_lookups` (provider `manga`),
//!     keyed by `{base}|{slug}`, via the shared singleflight `cached_fetch`, so
//!     a popular instance is hit at most once a day per linked account.
//!   * Only the user's *own* config drives the outbound call — there is no
//!     endpoint that fetches an arbitrary URL on demand.
//!
//! The MangaCollector public-profile JSON is modelled as a **tolerant subset**
//! (`#[serde(default)]` everywhere) so schema drift on the manga side degrades
//! gracefully rather than 500-ing the figurine side.

use crate::error::{AppError, AppResult};
use crate::external::cache;
use chrono::Duration;
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use uuid::Uuid;

/// Cache provider name in `external_lookups.provider`.
const PROVIDER: &str = "manga";
const CACHE_TTL_HOURS: i64 = 24;
const REQUEST_TIMEOUT_SECS: u64 = 20;
/// Cap on how many "reading → suggested figure" rows we surface.
const READING_LIMIT: i64 = 60;

// ─── MangaCollector public-profile shapes (tolerant subset) ──────────────────

/// A MangaCollector public profile, as returned by `GET {base}/api/public/u/{slug}`.
/// Unknown fields are ignored; missing fields fall back to their defaults so a
/// slightly different MangaCollector version still parses.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MangaProfile {
    #[serde(default)]
    pub display_name: String,
    #[serde(default)]
    pub library: Vec<MangaEntry>,
}

/// One series in the user's manga library. `mal_id` is the join key to the FC
/// catalogue; the rest is progress/metadata we surface on cross-links.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MangaEntry {
    pub mal_id: Option<i32>,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub image_url_jpg: Option<String>,
    #[serde(default)]
    pub volumes: Option<i32>,
    #[serde(default)]
    pub volumes_owned: Option<i32>,
    #[serde(default)]
    pub read_percent: Option<f64>,
    #[serde(default)]
    pub fully_read: Option<bool>,
    #[serde(default)]
    pub is_adult: Option<bool>,
}

impl MangaProfile {
    /// Number of series in the library.
    pub fn series_count(&self) -> i64 {
        self.library.len() as i64
    }

    /// Total volumes owned across the whole library.
    pub fn volumes_owned_total(&self) -> i64 {
        self.library
            .iter()
            .filter_map(|e| e.volumes_owned)
            .map(i64::from)
            .sum()
    }
}

// ─── Config (per-user server link + slug) ────────────────────────────────────
//
// The link itself — which admin-curated server + which public slug — lives in
// `domain::manga_servers` (`get_link` / `set_link` / `clear_link`), keyed on the
// `manga_servers` registry. Everything below only ever fetches when the linked
// server is `approved`; a `pending` or `revoked` server resolves to "no
// crossings / no badge", so the integration is dormant until an admin clears it.

// ─── Profile fetch (SSRF-guarded, cached 24h) ────────────────────────────────

/// Fetch (and cache for 24h) the public MangaCollector profile at
/// `{base}/api/public/u/{slug}`.
///
/// The composed URL is parsed (must be http/https), then run through the shared
/// SSRF guard *before* the request fires, and the request uses the no-redirect
/// client passed in by the route (`state.http_no_redirect`) so a 30x can't
/// bounce past the guard. Network / non-2xx / parse failures collapse to
/// `ServiceUnavailable` (a bad/unparseable URL is `BadRequest`) so the UI can
/// say "couldn't connect" instead of surfacing an internal error.
pub async fn fetch_profile(
    pool: &PgPool,
    http: &reqwest::Client,
    base_url: &str,
    slug: &str,
) -> AppResult<MangaProfile> {
    let base = base_url.trim().trim_end_matches('/');
    let slug = slug.trim();
    if base.is_empty() || slug.is_empty() {
        return Err(AppError::BadRequest("manga base URL and slug are required"));
    }

    // Build + validate the URL. Encoding the slug as a single path segment
    // keeps a slug like `../admin` from climbing the path.
    let mut url = reqwest::Url::parse(base)
        .map_err(|_| AppError::BadRequest("manga instance URL is not a valid URL"))?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err(AppError::BadRequest("manga instance URL must be http or https"));
    }
    url.path_segments_mut()
        .map_err(|_| AppError::BadRequest("manga instance URL cannot be a base"))?
        .extend(["api", "public", "u", slug]);
    let composed_url = url.to_string();

    // SSRF guard — reused from the notification channel adapters, NOT
    // duplicated. Rejects loopback / RFC-1918 / link-local / CGNAT / ULA /
    // metadata targets (resolving DNS first).
    crate::external::notify_channel::validate_outbound_url(&composed_url)
        .await
        .map_err(|_| AppError::BadRequest("manga instance URL not allowed"))?;

    let key = format!("{base}|{slug}");
    let http = http.clone();

    cache::cached_fetch::<MangaProfile, _, _>(
        pool,
        PROVIDER,
        "profile",
        &key,
        Duration::hours(CACHE_TTL_HOURS),
        move || async move {
            let resp = http
                .get(&composed_url)
                .header(
                    reqwest::header::USER_AGENT,
                    "Mozilla/5.0 (compatible; FigureCollector/0.1; +https://github.com/Dim145/FigureCollector)",
                )
                .header(reqwest::header::ACCEPT, "application/json")
                .header(reqwest::header::ACCEPT_ENCODING, "gzip, identity")
                .timeout(std::time::Duration::from_secs(REQUEST_TIMEOUT_SECS))
                .send()
                .await
                .map_err(|_| AppError::ServiceUnavailable("could not reach MangaCollector"))?;
            if !resp.status().is_success() {
                return Err(AppError::ServiceUnavailable("could not reach MangaCollector"));
            }
            resp.json::<MangaProfile>()
                .await
                .map_err(|_| AppError::ServiceUnavailable("could not reach MangaCollector"))
        },
    )
    .await
}

/// Force a fresh pull of the profile: drop the cached copy, then re-fetch (and
/// re-cache). Used by the manual sync so a just-updated MangaCollector library
/// shows up immediately instead of after the 24h TTL.
pub async fn refresh_profile(
    pool: &PgPool,
    http: &reqwest::Client,
    base_url: &str,
    slug: &str,
) -> AppResult<MangaProfile> {
    // Recompute the exact cache key `fetch_profile` uses (trimmed base + slug).
    let base = base_url.trim().trim_end_matches('/');
    let slug_t = slug.trim();
    cache::invalidate(pool, PROVIDER, "profile", &format!("{base}|{slug_t}")).await?;
    fetch_profile(pool, http, base_url, slug).await
}

// ─── Reverse direction: figures for a MAL series (public) ────────────────────

/// A catalogue figure linked to a given MAL series, trimmed for the public
/// "figures for this manga" surface.
#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct FigureRef {
    pub name: String,
    pub slug: String,
    pub figure_type: String,
    pub image: Option<String>,
}

/// Every catalogue figure whose series carries `mal_id`. NSFW figures are
/// excluded when `exclude_nsfw`. `image` is the figure's `official_image_url`
/// (may be `None` — the SPA falls back to its own placeholder / photo fetch).
pub async fn figures_by_mal(
    pool: &PgPool,
    mal_id: i32,
    exclude_nsfw: bool,
) -> AppResult<Vec<FigureRef>> {
    let sql = format!(
        "SELECT DISTINCT f.name, f.slug, f.figure_type, f.official_image_url AS image
         FROM figures f
         JOIN figure_series fs ON fs.figure_id = f.id
         JOIN series s ON s.id = fs.series_id
         WHERE (s.mal_id = $1 OR s.manga_mal_id = $1){nsfw}
         ORDER BY f.name",
        nsfw = if exclude_nsfw { " AND NOT f.is_nsfw" } else { "" },
    );
    Ok(sqlx::query_as::<_, FigureRef>(&sql)
        .bind(mal_id)
        .fetch_all(pool)
        .await?)
}

// ─── Forward direction: crossings (dual + reading) ───────────────────────────

/// A series the user both reads (in MangaCollector) AND owns figures of (in FC).
#[derive(Debug, Clone, Serialize)]
pub struct DualItem {
    pub mal_id: i32,
    /// FC series name.
    pub series_name: String,
    /// MangaCollector series name (may differ in romanisation).
    pub manga_name: String,
    /// How many active (non-archived) figures the user owns of this series.
    pub figure_count: i64,
    pub read_percent: Option<f64>,
    pub volumes_owned: Option<i32>,
    pub volumes: Option<i32>,
}

/// A catalogue figure for a series the user reads but does NOT yet own — a
/// "you read this, here's a figure" suggestion.
#[derive(Debug, Clone, Serialize)]
pub struct ReadingItem {
    pub mal_id: i32,
    /// FC catalogue figure id (UUID) — the `/figures/:id` link target.
    pub id: Uuid,
    pub name: String,
    pub figure_type: String,
    pub image: Option<String>,
    /// FC series name.
    pub series_name: String,
    /// MangaCollector series name.
    pub manga_name: String,
    pub read_percent: Option<f64>,
    pub volumes_owned: Option<i32>,
    pub volumes: Option<i32>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Crossings {
    /// Series read on the manga side with ≥1 owned figure on the FC side.
    pub dual: Vec<DualItem>,
    /// Figures the user could buy for series they're already reading.
    pub reading: Vec<ReadingItem>,
}

/// Internal row shape for the `dual` query. Both ids are nullable: a row can
/// match the library via its own `mal_id` OR its cross-media `manga_mal_id`.
#[derive(sqlx::FromRow)]
struct DualRow {
    mal_id: Option<i32>,
    manga_mal_id: Option<i32>,
    series_name: String,
    figure_count: i64,
}

/// Internal row shape for the `reading` query.
#[derive(sqlx::FromRow)]
struct ReadingRow {
    mal_id: Option<i32>,
    manga_mal_id: Option<i32>,
    id: Uuid,
    name: String,
    figure_type: String,
    image: Option<String>,
    series_name: String,
}

/// Compute the two-way crossings between the user's MangaCollector library and
/// their FC catalogue/collection. Returns empty when the user hasn't linked an
/// instance. Enriches every row with the manga-side progress from the profile.
pub async fn crossings(
    pool: &PgPool,
    http: &reqwest::Client,
    user_id: Uuid,
    exclude_nsfw: bool,
) -> AppResult<Crossings> {
    // Only an APPROVED linked server drives a fetch — pending / revoked / unlinked
    // all collapse to "no crossings".
    let Some(link) = crate::domain::manga_servers::get_link(pool, user_id).await? else {
        return Ok(Crossings {
            dual: Vec::new(),
            reading: Vec::new(),
        });
    };
    if !link.is_approved() {
        return Ok(Crossings {
            dual: Vec::new(),
            reading: Vec::new(),
        });
    }
    let (base, slug) = (link.base_url, link.slug);

    let profile = fetch_profile(pool, http, &base, &slug).await?;

    // mal_id -> entry (skip entries with no MAL id — they can't be joined).
    let by_mal: std::collections::HashMap<i32, &MangaEntry> = profile
        .library
        .iter()
        .filter_map(|e| e.mal_id.map(|id| (id, e)))
        .collect();
    if by_mal.is_empty() {
        return Ok(Crossings {
            dual: Vec::new(),
            reading: Vec::new(),
        });
    }
    let mal_ids: Vec<i32> = by_mal.keys().copied().collect();

    // ── dual: FC series the user owns ≥1 active figure of, whose mal_id is in
    // the manga library. The owned-items join is what scopes this to the
    // viewer's own collection. The NSFW filter (when on) drops series whose
    // only owned figures are NSFW.
    let dual_nsfw = if exclude_nsfw {
        " JOIN figures f ON f.id = fs.figure_id AND NOT f.is_nsfw"
    } else {
        ""
    };
    let dual_sql = format!(
        "SELECT s.mal_id AS mal_id, s.manga_mal_id AS manga_mal_id, s.name AS series_name, COUNT(DISTINCT o.figure_id) AS figure_count
         FROM series s
         JOIN figure_series fs ON fs.series_id = s.id
         JOIN owned_items o ON o.figure_id = fs.figure_id
            AND o.user_id = $1 AND o.archived_at IS NULL{dual_nsfw}
         WHERE (s.manga_mal_id = ANY($2::int[]) OR s.mal_id = ANY($2::int[]))
         GROUP BY s.id, s.mal_id, s.manga_mal_id, s.name
         ORDER BY figure_count DESC, s.name"
    );
    let dual_rows: Vec<DualRow> = sqlx::query_as(&dual_sql)
        .bind(user_id)
        .bind(&mal_ids)
        .fetch_all(pool)
        .await?;
    let dual = dual_rows
        .into_iter()
        .filter_map(|r| {
            // Whichever of the two ids is actually in the library is the match
            // (manga_mal_id wins; the 0 sentinel is never a library key).
            let key = [r.manga_mal_id, r.mal_id]
                .into_iter()
                .flatten()
                .find(|id| by_mal.contains_key(id))?;
            let entry = by_mal.get(&key);
            Some(DualItem {
                mal_id: key,
                series_name: r.series_name,
                manga_name: entry.map(|e| e.name.clone()).unwrap_or_default(),
                figure_count: r.figure_count,
                read_percent: entry.and_then(|e| e.read_percent),
                volumes_owned: entry.and_then(|e| e.volumes_owned),
                volumes: entry.and_then(|e| e.volumes),
            })
        })
        .collect();

    // ── reading: catalogue figures for a read series the user does NOT own —
    // purchase suggestions. NOT EXISTS scopes "doesn't own" to active items.
    let reading_sql = format!(
        "SELECT s.mal_id AS mal_id, s.manga_mal_id AS manga_mal_id, f.id AS id, f.name AS name, f.figure_type AS figure_type,
                f.official_image_url AS image, s.name AS series_name
         FROM figures f
         JOIN figure_series fs ON fs.figure_id = f.id
         JOIN series s ON s.id = fs.series_id
         WHERE (s.manga_mal_id = ANY($2::int[]) OR s.mal_id = ANY($2::int[]))
           AND NOT EXISTS (
                SELECT 1 FROM owned_items o
                WHERE o.user_id = $1 AND o.figure_id = f.id AND o.archived_at IS NULL
           ){nsfw}
         ORDER BY f.created_at DESC
         LIMIT {limit}",
        nsfw = if exclude_nsfw { " AND NOT f.is_nsfw" } else { "" },
        limit = READING_LIMIT,
    );
    let reading_rows: Vec<ReadingRow> = sqlx::query_as(&reading_sql)
        .bind(user_id)
        .bind(&mal_ids)
        .fetch_all(pool)
        .await?;
    let reading = reading_rows
        .into_iter()
        .filter_map(|r| {
            let key = [r.manga_mal_id, r.mal_id]
                .into_iter()
                .flatten()
                .find(|id| by_mal.contains_key(id))?;
            let entry = by_mal.get(&key);
            Some(ReadingItem {
                mal_id: key,
                id: r.id,
                name: r.name,
                figure_type: r.figure_type,
                image: r.image,
                series_name: r.series_name,
                manga_name: entry.map(|e| e.name.clone()).unwrap_or_default(),
                read_percent: entry.and_then(|e| e.read_percent),
                volumes_owned: entry.and_then(|e| e.volumes_owned),
                volumes: entry.and_then(|e| e.volumes),
            })
        })
        .collect();

    Ok(Crossings { dual, reading })
}

// ─── Backfill: the cross-media join key (series.manga_mal_id) ─────────────────

/// Fill `series.manga_mal_id` for series that carry an AniList id but haven't
/// been resolved yet (NULL). For each, ask AniList for the manga-side MAL id
/// (cached 24h) and store it — or store the sentinel `0` ("no manga side") so it
/// isn't reprocessed and never matches a real id. `limit` caps one run;
/// `only_user` scopes to the series of that user's owned figures (the per-user
/// "sync"), `None` sweeps the whole catalogue (the daily cron). `http` is the
/// regular (redirect-following) client — AniList, not a user instance. Returns
/// how many got a *real* manga id this run.
pub async fn backfill_manga_mal(
    pool: &PgPool,
    http: &reqwest::Client,
    limit: i64,
    only_user: Option<Uuid>,
) -> AppResult<u32> {
    let todo: Vec<(Uuid, i32)> = if let Some(uid) = only_user {
        sqlx::query_as(
            "SELECT DISTINCT s.id, s.anilist_id
             FROM series s
             JOIN figure_series fs ON fs.series_id = s.id
             JOIN owned_items o ON o.figure_id = fs.figure_id
                AND o.user_id = $1 AND o.archived_at IS NULL
             WHERE s.anilist_id IS NOT NULL AND s.manga_mal_id IS NULL
             LIMIT $2",
        )
        .bind(uid)
        .bind(limit)
        .fetch_all(pool)
        .await?
    } else {
        sqlx::query_as(
            // `series` has no `updated_at` column — order by `created_at` so the
            // most recently added series get their manga id resolved first. The
            // ordering only prioritises which rows a capped run picks up.
            "SELECT id, anilist_id FROM series
             WHERE anilist_id IS NOT NULL AND manga_mal_id IS NULL
             ORDER BY created_at DESC
             LIMIT $1",
        )
        .bind(limit)
        .fetch_all(pool)
        .await?
    };

    let mut filled = 0u32;
    for (series_id, anilist_id) in todo {
        match crate::external::anilist::resolve_manga_mal(pool, http, anilist_id as i64).await {
            Ok(Some(mal)) => {
                sqlx::query(
                    "UPDATE series SET manga_mal_id = $1 WHERE id = $2 AND manga_mal_id IS NULL",
                )
                .bind(mal)
                .bind(series_id)
                .execute(pool)
                .await?;
                filled += 1;
            }
            // No manga side — mark with the 0 sentinel so it isn't reprocessed.
            Ok(None) => {
                sqlx::query(
                    "UPDATE series SET manga_mal_id = 0 WHERE id = $1 AND manga_mal_id IS NULL",
                )
                .bind(series_id)
                .execute(pool)
                .await?;
            }
            Err(e) => {
                tracing::debug!(error = %e, series = %series_id,
                    "manga-mal resolve failed; will retry next run");
            }
        }
    }
    Ok(filled)
}

// ─── Per-figure manga link ───────────────────────────────────────────────────

/// The manga-library entry a single figure maps to (via its series' MAL id), if
/// the user reads that series. `None` when the figure has no MAL-tagged series,
/// or the user isn't reading it. Trimmed to the progress bits the figure-detail
/// page surfaces.
#[derive(Debug, Clone, Serialize)]
pub struct FigureMangaLink {
    /// The matched manga's MyAnimeList id — the key MangaCollector deep-links on
    /// (`{base}/mangapage?mal_id=`). Set whenever this struct is `Some` (the
    /// match is found *by* this id), so the figure badge can open the manga page.
    pub mal_id: Option<i32>,
    pub name: String,
    pub read_percent: Option<f64>,
    pub volumes_owned: Option<i32>,
    pub volumes: Option<i32>,
    pub fully_read: Option<bool>,
}

/// Resolve `figure_id` → its series' MAL id → the user's manga-library entry.
/// Returns `Ok(None)` (not an error) when the figure has no MAL series or the
/// user hasn't linked an instance / isn't reading that series.
pub async fn figure_manga_link(
    pool: &PgPool,
    http: &reqwest::Client,
    user_id: Uuid,
    figure_id: Uuid,
) -> AppResult<Option<FigureMangaLink>> {
    // The figure's series ids (figures can carry several) — both the own mal_id
    // and the cross-media manga_mal_id, since the library is keyed on the manga.
    let ids: Option<(Option<i32>, Option<i32>)> = sqlx::query_as(
        "SELECT s.mal_id, s.manga_mal_id FROM figure_series fs
         JOIN series s ON s.id = fs.series_id
         WHERE fs.figure_id = $1
           AND (s.mal_id IS NOT NULL OR (s.manga_mal_id IS NOT NULL AND s.manga_mal_id <> 0))
         LIMIT 1",
    )
    .bind(figure_id)
    .fetch_optional(pool)
    .await?;
    let Some((mal_id, manga_mal_id)) = ids else {
        return Ok(None);
    };
    // Candidate keys to match the library on (manga side first; never the 0
    // sentinel).
    let candidates: Vec<i32> = [manga_mal_id.filter(|v| *v != 0), mal_id]
        .into_iter()
        .flatten()
        .collect();

    let Some(link) = crate::domain::manga_servers::get_link(pool, user_id).await? else {
        return Ok(None);
    };
    if !link.is_approved() {
        return Ok(None);
    }
    let (base, slug) = (link.base_url, link.slug);

    let profile = fetch_profile(pool, http, &base, &slug).await?;
    let entry = profile
        .library
        .iter()
        .find(|e| e.mal_id.is_some_and(|m| candidates.contains(&m)));
    Ok(entry.map(|e| FigureMangaLink {
        mal_id: e.mal_id,
        name: e.name.clone(),
        read_percent: e.read_percent,
        volumes_owned: e.volumes_owned,
        volumes: e.volumes,
        fully_read: e.fully_read,
    }))
}

/// Resolve a *series* → its MAL id(s) → the user's manga-library entry, returning
/// the matched library `mal_id` (the key MangaCollector deep-links on) when the
/// user reads that series, else `None`. Mirrors [`figure_manga_link`] but
/// series-scoped — it powers the series page's "open in MangaCollector" button,
/// which only shows for an approved link with an actual match.
pub async fn series_manga_link(
    pool: &PgPool,
    http: &reqwest::Client,
    user_id: Uuid,
    series_id: Uuid,
) -> AppResult<Option<i32>> {
    // The series' own mal_id and its cross-media manga_mal_id (the library is
    // keyed on the manga side, so the latter wins when present).
    let ids: Option<(Option<i32>, Option<i32>)> = sqlx::query_as(
        "SELECT s.mal_id, s.manga_mal_id FROM series s
         WHERE s.id = $1
           AND (s.mal_id IS NOT NULL OR (s.manga_mal_id IS NOT NULL AND s.manga_mal_id <> 0))",
    )
    .bind(series_id)
    .fetch_optional(pool)
    .await?;
    let Some((mal_id, manga_mal_id)) = ids else {
        return Ok(None);
    };
    let candidates: Vec<i32> = [manga_mal_id.filter(|v| *v != 0), mal_id]
        .into_iter()
        .flatten()
        .collect();

    let Some(link) = crate::domain::manga_servers::get_link(pool, user_id).await? else {
        return Ok(None);
    };
    if !link.is_approved() {
        return Ok(None);
    }

    let profile = fetch_profile(pool, http, &link.base_url, &link.slug).await?;
    Ok(profile
        .library
        .iter()
        .find_map(|e| e.mal_id.filter(|m| candidates.contains(m))))
}

//! AniList GraphQL client.
//!
//! Public, unauthenticated for read-only queries. Rate limit is 90 req/min
//! per IP; we rely on the PG cache (24 h TTL) to keep us comfortably under it.

use crate::error::{AppError, AppResult};
use crate::external::cache;
use chrono::Duration;
use serde::{Deserialize, Serialize};
use sqlx::PgPool;

const ANILIST_ENDPOINT: &str = "https://graphql.anilist.co";
const CACHE_TTL_HOURS: i64 = 24;
const PROVIDER: &str = "anilist";

// -----------------------------------------------------------------------------
// Response model — only the fields we actually map into our `series` /
// `characters` tables. Extending later is purely additive.
// -----------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AniListMedia {
    pub id: i64,
    /// MAL id, when AniList knows it. Surfacing this lets us pre-fill the
    /// `mal_id` column on `series` without an extra Jikan round-trip.
    #[serde(rename = "idMal")]
    pub id_mal: Option<i64>,
    pub title: AniListTitle,
    #[serde(rename = "type")]
    pub media_type: Option<String>, // ANIME | MANGA
    pub format: Option<String>,
    pub status: Option<String>,
    pub description: Option<String>,
    #[serde(rename = "coverImage")]
    pub cover_image: Option<AniListImage>,
    #[serde(rename = "siteUrl")]
    pub site_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AniListTitle {
    pub romaji: Option<String>,
    pub english: Option<String>,
    pub native: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AniListImage {
    pub large: Option<String>,
    pub medium: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AniListCharacter {
    pub id: i64,
    pub name: AniListCharacterName,
    pub image: Option<AniListImage>,
    /// Long-form description. Populated by [`get_character`]; the embedded
    /// list inside `MediaDetail` leaves this `None` to keep payloads small.
    #[serde(default)]
    pub description: Option<String>,
    #[serde(rename = "siteUrl", default)]
    pub site_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AniListCharacterName {
    pub full: Option<String>,
    pub native: Option<String>,
}

/// A character search hit. Lighter than [`AniListCharacter`] (no description),
/// but carries the `media` it appears in so the picker can disambiguate
/// homonyms ("which Saber?"). `media` is only populated for the *un-scoped*
/// free search — when the search is already scoped to a series there's
/// nothing to disambiguate.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AniListCharacterResult {
    pub id: i64,
    pub name: AniListCharacterName,
    pub image: Option<AniListImage>,
    #[serde(default)]
    pub media: Vec<AniListCharacterMedia>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AniListCharacterMedia {
    pub id: i64,
    pub title: AniListTitle,
}

// -----------------------------------------------------------------------------
// Search + lookup
// -----------------------------------------------------------------------------

/// Search media (anime + manga) by free-text. Cached for 24h by query string.
pub async fn search_media(
    pool: &PgPool,
    http: &reqwest::Client,
    query: &str,
) -> AppResult<Vec<AniListMedia>> {
    let trimmed = query.trim();
    if trimmed.is_empty() {
        return Ok(vec![]);
    }
    let cache_key = format!("search:{}", trimmed.to_lowercase());

    cache::cached_fetch(
        pool,
        PROVIDER,
        "media-search",
        &cache_key,
        Duration::hours(CACHE_TTL_HOURS),
        || async {
            #[derive(Deserialize)]
            struct Resp {
                data: Option<Data>,
                errors: Option<Vec<serde_json::Value>>,
            }
            #[derive(Deserialize)]
            struct Data {
                #[serde(rename = "Page")]
                page: Page,
            }
            #[derive(Deserialize)]
            struct Page {
                media: Vec<AniListMedia>,
            }

            let body = serde_json::json!({
                "query": r#"
                    query ($q: String) {
                        Page(perPage: 12) {
                            media(search: $q, sort: SEARCH_MATCH) {
                                id
                                idMal
                                title { romaji english native }
                                type
                                format
                                status
                                description(asHtml: false)
                                coverImage { large medium }
                                siteUrl
                            }
                        }
                    }
                "#,
                "variables": { "q": trimmed },
            });

            let resp: Resp = http
                .post(ANILIST_ENDPOINT)
                .json(&body)
                .send()
                .await
                .map_err(|e| AppError::Internal(anyhow::anyhow!("AniList request failed: {e}")))?
                .json()
                .await
                .map_err(|e| AppError::Internal(anyhow::anyhow!("AniList JSON parse failed: {e}")))?;

            if let Some(errs) = resp.errors {
                return Err(AppError::Internal(anyhow::anyhow!(
                    "AniList errors: {errs:?}"
                )));
            }
            Ok(resp
                .data
                .map(|d| d.page.media)
                .unwrap_or_default())
        },
    )
    .await
}

/// Fetch a single media + main characters by AniList id. Cached for 24h.
pub async fn get_media_with_characters(
    pool: &PgPool,
    http: &reqwest::Client,
    anilist_id: i64,
) -> AppResult<MediaDetail> {
    cache::cached_fetch(
        pool,
        PROVIDER,
        "media",
        &anilist_id.to_string(),
        Duration::hours(CACHE_TTL_HOURS),
        || async {
            #[derive(Deserialize)]
            struct Resp {
                data: Option<Data>,
                errors: Option<Vec<serde_json::Value>>,
            }
            #[derive(Deserialize)]
            struct Data {
                #[serde(rename = "Media")]
                media: MediaPayload,
            }
            #[derive(Deserialize)]
            struct MediaPayload {
                id: i64,
                #[serde(rename = "idMal")]
                id_mal: Option<i64>,
                title: AniListTitle,
                #[serde(rename = "type")]
                media_type: Option<String>,
                format: Option<String>,
                status: Option<String>,
                description: Option<String>,
                #[serde(rename = "coverImage")]
                cover_image: Option<AniListImage>,
                #[serde(rename = "siteUrl")]
                site_url: Option<String>,
                characters: Option<CharactersConn>,
            }
            #[derive(Deserialize)]
            struct CharactersConn {
                nodes: Vec<AniListCharacter>,
            }

            let body = serde_json::json!({
                "query": r#"
                    query ($id: Int) {
                        Media(id: $id) {
                            id
                            idMal
                            title { romaji english native }
                            type
                            format
                            status
                            description(asHtml: false)
                            coverImage { large medium }
                            siteUrl
                            characters(role: MAIN, perPage: 25, sort: ROLE) {
                                nodes {
                                    id
                                    name { full native }
                                    image { large medium }
                                }
                            }
                        }
                    }
                "#,
                "variables": { "id": anilist_id },
            });

            let resp: Resp = http
                .post(ANILIST_ENDPOINT)
                .json(&body)
                .send()
                .await
                .map_err(|e| AppError::Internal(anyhow::anyhow!("AniList request failed: {e}")))?
                .json()
                .await
                .map_err(|e| AppError::Internal(anyhow::anyhow!("AniList JSON parse failed: {e}")))?;

            if let Some(errs) = resp.errors {
                return Err(AppError::Internal(anyhow::anyhow!(
                    "AniList errors: {errs:?}"
                )));
            }
            let m = resp
                .data
                .map(|d| d.media)
                .ok_or(AppError::NotFound)?;

            Ok(MediaDetail {
                media: AniListMedia {
                    id: m.id,
                    id_mal: m.id_mal,
                    title: m.title,
                    media_type: m.media_type,
                    format: m.format,
                    status: m.status,
                    description: m.description,
                    cover_image: m.cover_image,
                    site_url: m.site_url,
                },
                characters: m.characters.map(|c| c.nodes).unwrap_or_default(),
            })
        },
    )
    .await
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MediaDetail {
    pub media: AniListMedia,
    pub characters: Vec<AniListCharacter>,
}

/// Resolve the MANGA-side MAL id for an AniList media — the join key the
/// MangaCollector library uses. For a manga, that's its own `idMal`; for an
/// anime, it's the MAL id of its related source/adaptation manga (an anime and
/// its manga have *different* MAL ids, so a figure tagged with the anime would
/// never line up with a manga shelf otherwise). Returns `Ok(None)` when there's
/// no manga side (an anime original, or AniList has no MAL mapping). Cached 24h,
/// including the negative result, so the daily backfill is cheap on re-runs.
pub async fn resolve_manga_mal(
    pool: &PgPool,
    http: &reqwest::Client,
    anilist_id: i64,
) -> AppResult<Option<i32>> {
    cache::cached_fetch::<Option<i32>, _, _>(
        pool,
        PROVIDER,
        "manga-mal",
        &anilist_id.to_string(),
        Duration::hours(CACHE_TTL_HOURS),
        || async {
            #[derive(Deserialize)]
            struct Resp {
                data: Option<Data>,
                errors: Option<Vec<serde_json::Value>>,
            }
            #[derive(Deserialize)]
            struct Data {
                #[serde(rename = "Media")]
                media: Option<MediaP>,
            }
            #[derive(Deserialize)]
            struct MediaP {
                #[serde(rename = "idMal")]
                id_mal: Option<i64>,
                #[serde(rename = "type")]
                media_type: Option<String>,
                relations: Option<Relations>,
            }
            #[derive(Deserialize)]
            struct Relations {
                edges: Vec<Edge>,
            }
            #[derive(Deserialize)]
            struct Edge {
                #[serde(rename = "relationType")]
                relation_type: Option<String>,
                node: Option<Node>,
            }
            #[derive(Deserialize)]
            struct Node {
                #[serde(rename = "idMal")]
                id_mal: Option<i64>,
                #[serde(rename = "type")]
                media_type: Option<String>,
                format: Option<String>,
            }

            let body = serde_json::json!({
                "query": r#"
                    query ($id: Int) {
                        Media(id: $id) {
                            idMal
                            type
                            relations { edges { relationType node { idMal type format } } }
                        }
                    }
                "#,
                "variables": { "id": anilist_id },
            });

            let resp: Resp = http
                .post(ANILIST_ENDPOINT)
                .json(&body)
                .send()
                .await
                .map_err(|e| AppError::Internal(anyhow::anyhow!("AniList request failed: {e}")))?
                .json()
                .await
                .map_err(|e| AppError::Internal(anyhow::anyhow!("AniList JSON parse failed: {e}")))?;

            if let Some(errs) = resp.errors {
                return Err(AppError::Internal(anyhow::anyhow!("AniList errors: {errs:?}")));
            }
            let Some(media) = resp.data.and_then(|d| d.media) else {
                return Ok(None);
            };

            // A manga's own MAL id is the join key directly.
            if media.media_type.as_deref() == Some("MANGA") {
                return Ok(media.id_mal.map(|v| v as i32));
            }

            // An anime: pick its related manga's MAL id. Prefer the strongest
            // relation (SOURCE > ADAPTATION > PARENT > anything) and a MANGA
            // format over a one-shot / light-novel, so a spin-off doesn't win
            // over the actual source manga.
            fn rel_rank(rel: Option<&str>) -> u8 {
                match rel {
                    Some("SOURCE") => 0,
                    Some("ADAPTATION") => 1,
                    Some("PARENT") => 2,
                    _ => 3,
                }
            }
            fn fmt_rank(fmt: Option<&str>) -> u8 {
                match fmt {
                    Some("MANGA") => 0,
                    Some("ONE_SHOT") => 1,
                    _ => 2,
                }
            }
            let best = media
                .relations
                .map(|r| r.edges)
                .unwrap_or_default()
                .into_iter()
                .filter_map(|e| {
                    let n = e.node?;
                    if n.media_type.as_deref() != Some("MANGA") {
                        return None;
                    }
                    let mal = n.id_mal?;
                    Some((rel_rank(e.relation_type.as_deref()), fmt_rank(n.format.as_deref()), mal))
                })
                .min_by_key(|(rel, fmt, _)| (*rel, *fmt));

            Ok(best.map(|(_, _, mal)| mal as i32))
        },
    )
    .await
}

/// Fetch a single AniList character by id. Cached for 24h.
///
/// Surfaces the full character — name + image + long-form description +
/// site URL. Used by the admin "Refetch from AniList" button to overwrite
/// stale local copies.
pub async fn get_character(
    pool: &PgPool,
    http: &reqwest::Client,
    anilist_id: i64,
) -> AppResult<AniListCharacter> {
    cache::cached_fetch(
        pool,
        PROVIDER,
        "character",
        &anilist_id.to_string(),
        Duration::hours(CACHE_TTL_HOURS),
        || async {
            #[derive(Deserialize)]
            struct Resp {
                data: Option<Data>,
                errors: Option<Vec<serde_json::Value>>,
            }
            #[derive(Deserialize)]
            struct Data {
                #[serde(rename = "Character")]
                character: AniListCharacter,
            }

            let body = serde_json::json!({
                "query": r#"
                    query ($id: Int) {
                        Character(id: $id) {
                            id
                            name { full native }
                            image { large medium }
                            description(asHtml: false)
                            siteUrl
                        }
                    }
                "#,
                "variables": { "id": anilist_id },
            });

            let resp: Resp = http
                .post(ANILIST_ENDPOINT)
                .json(&body)
                .send()
                .await
                .map_err(|e| AppError::Internal(anyhow::anyhow!("AniList request failed: {e}")))?
                .json()
                .await
                .map_err(|e| AppError::Internal(anyhow::anyhow!("AniList JSON parse failed: {e}")))?;

            if let Some(errs) = resp.errors {
                return Err(AppError::Internal(anyhow::anyhow!(
                    "AniList errors: {errs:?}"
                )));
            }
            resp.data.map(|d| d.character).ok_or(AppError::NotFound)
        },
    )
    .await
}

/// Search characters by free-text, optionally scoped to a series (AniList
/// media id).
///
/// AniList's `Media.characters` connection has **no `search` argument**, so a
/// scoped search can't be done server-side at AniList. Instead, when
/// `media_id` is set, we fetch that media's full character roster once
/// (cached 24h) and filter it locally by name. An empty query in scoped mode
/// returns the whole roster — handy as initial suggestions once a series is
/// picked. Un-scoped, it's a normal `Page { characters(search:) }` query and
/// needs a non-empty query.
pub async fn search_characters(
    pool: &PgPool,
    http: &reqwest::Client,
    query: &str,
    media_id: Option<i64>,
) -> AppResult<Vec<AniListCharacterResult>> {
    let trimmed = query.trim();

    // ── Scoped to a series: filter the media's roster locally. ──
    if let Some(mid) = media_id {
        let roster = media_characters(pool, http, mid).await?;
        if trimmed.is_empty() {
            return Ok(roster);
        }
        let needle = trimmed.to_lowercase();
        let matches = |s: &Option<String>| {
            s.as_deref()
                .map(|v| v.to_lowercase().contains(&needle))
                .unwrap_or(false)
        };
        return Ok(roster
            .into_iter()
            .filter(|c| matches(&c.name.full) || matches(&c.name.native))
            .collect());
    }

    // ── Free search across all of AniList. ──
    if trimmed.is_empty() {
        return Ok(vec![]);
    }
    let cache_key = format!("char-search:{}", trimmed.to_lowercase());
    cache::cached_fetch(
        pool,
        PROVIDER,
        "character-search",
        &cache_key,
        Duration::hours(CACHE_TTL_HOURS),
        || async {
            #[derive(Deserialize)]
            struct Resp {
                data: Option<Data>,
                errors: Option<Vec<serde_json::Value>>,
            }
            #[derive(Deserialize)]
            struct Data {
                #[serde(rename = "Page")]
                page: Page,
            }
            #[derive(Deserialize)]
            struct Page {
                characters: Vec<CharNode>,
            }
            #[derive(Deserialize)]
            struct CharNode {
                id: i64,
                name: AniListCharacterName,
                image: Option<AniListImage>,
                media: Option<MediaConn>,
            }
            #[derive(Deserialize)]
            struct MediaConn {
                nodes: Vec<AniListCharacterMedia>,
            }

            let body = serde_json::json!({
                "query": r#"
                    query ($q: String) {
                        Page(perPage: 15) {
                            characters(search: $q, sort: SEARCH_MATCH) {
                                id
                                name { full native }
                                image { large medium }
                                media(perPage: 4, sort: POPULARITY_DESC) {
                                    nodes { id title { romaji english native } }
                                }
                            }
                        }
                    }
                "#,
                "variables": { "q": trimmed },
            });

            let resp: Resp = http
                .post(ANILIST_ENDPOINT)
                .json(&body)
                .send()
                .await
                .map_err(|e| AppError::Internal(anyhow::anyhow!("AniList request failed: {e}")))?
                .json()
                .await
                .map_err(|e| AppError::Internal(anyhow::anyhow!("AniList JSON parse failed: {e}")))?;

            if let Some(errs) = resp.errors {
                return Err(AppError::Internal(anyhow::anyhow!("AniList errors: {errs:?}")));
            }
            Ok(resp
                .data
                .map(|d| {
                    d.page
                        .characters
                        .into_iter()
                        .map(|c| AniListCharacterResult {
                            id: c.id,
                            name: c.name,
                            image: c.image,
                            media: c.media.map(|m| m.nodes).unwrap_or_default(),
                        })
                        .collect()
                })
                .unwrap_or_default())
        },
    )
    .await
}

/// Full character roster of a media (all roles, role-sorted so mains lead),
/// cached 24h. The source set for the series-scoped character search.
async fn media_characters(
    pool: &PgPool,
    http: &reqwest::Client,
    media_id: i64,
) -> AppResult<Vec<AniListCharacterResult>> {
    cache::cached_fetch(
        pool,
        PROVIDER,
        "media-character-roster",
        &media_id.to_string(),
        Duration::hours(CACHE_TTL_HOURS),
        || async {
            #[derive(Deserialize)]
            struct Resp {
                data: Option<Data>,
                errors: Option<Vec<serde_json::Value>>,
            }
            #[derive(Deserialize)]
            struct Data {
                #[serde(rename = "Media")]
                media: Option<MediaPayload>,
            }
            #[derive(Deserialize)]
            struct MediaPayload {
                characters: Option<CharactersConn>,
            }
            #[derive(Deserialize)]
            struct CharactersConn {
                nodes: Vec<CharNode>,
            }
            #[derive(Deserialize)]
            struct CharNode {
                id: i64,
                name: AniListCharacterName,
                image: Option<AniListImage>,
            }

            let body = serde_json::json!({
                "query": r#"
                    query ($id: Int) {
                        Media(id: $id) {
                            characters(perPage: 50, sort: [ROLE, RELEVANCE]) {
                                nodes {
                                    id
                                    name { full native }
                                    image { large medium }
                                }
                            }
                        }
                    }
                "#,
                "variables": { "id": media_id },
            });

            let resp: Resp = http
                .post(ANILIST_ENDPOINT)
                .json(&body)
                .send()
                .await
                .map_err(|e| AppError::Internal(anyhow::anyhow!("AniList request failed: {e}")))?
                .json()
                .await
                .map_err(|e| AppError::Internal(anyhow::anyhow!("AniList JSON parse failed: {e}")))?;

            if let Some(errs) = resp.errors {
                return Err(AppError::Internal(anyhow::anyhow!("AniList errors: {errs:?}")));
            }
            Ok(resp
                .data
                .and_then(|d| d.media)
                .and_then(|m| m.characters)
                .map(|c| {
                    c.nodes
                        .into_iter()
                        .map(|n| AniListCharacterResult {
                            id: n.id,
                            name: n.name,
                            image: n.image,
                            media: Vec::new(),
                        })
                        .collect()
                })
                .unwrap_or_default())
        },
    )
    .await
}

// -----------------------------------------------------------------------------
// Mapping helpers — AniList media → our `series` table origin / preferred title.
// Kept as public API surface so the admin metadata-import path can reach for
// them; not all callers have migrated to the helper layer yet.
// -----------------------------------------------------------------------------

#[allow(dead_code)]
pub fn origin_from_media(m: &AniListMedia) -> &'static str {
    match m.media_type.as_deref() {
        Some("ANIME") => "anime",
        Some("MANGA") => match m.format.as_deref() {
            Some("NOVEL") => "light_novel",
            _ => "manga",
        },
        _ => "other",
    }
}

#[allow(dead_code)]
pub fn best_title(t: &AniListTitle) -> Option<String> {
    t.romaji
        .clone()
        .or_else(|| t.english.clone())
        .or_else(|| t.native.clone())
}

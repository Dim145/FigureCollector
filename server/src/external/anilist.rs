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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AniListCharacterName {
    pub full: Option<String>,
    pub native: Option<String>,
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

// -----------------------------------------------------------------------------
// Mapping helpers — AniList media → our `series` table origin / preferred title
// -----------------------------------------------------------------------------

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

pub fn best_title(t: &AniListTitle) -> Option<String> {
    t.romaji
        .clone()
        .or_else(|| t.english.clone())
        .or_else(|| t.native.clone())
}

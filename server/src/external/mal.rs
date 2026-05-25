//! MyAnimeList integration via Jikan (api.jikan.moe).
//!
//! Jikan is the long-running unofficial public REST API in front of MAL. We
//! use it because MAL's official API requires OAuth and registered apps,
//! which would be intrusive for a self-hosted PWA. Jikan v4 is rate-limited
//! to 3 req/s and 60 req/min per IP — well within reach as long as we cache.
//!
//! Cache: `external_lookups` 24 h TTL per query (search) or per id (detail).

use crate::error::{AppError, AppResult};
use crate::external::cache;
use chrono::Duration;
use serde::{Deserialize, Serialize};
use sqlx::PgPool;

const ENDPOINT: &str = "https://api.jikan.moe/v4";
const CACHE_TTL_HOURS: i64 = 24;
const PROVIDER: &str = "mal";
const SEARCH_TIMEOUT_SECS: u64 = 20;

// -----------------------------------------------------------------------------
// Response shapes (only the fields we use)
// -----------------------------------------------------------------------------

/// One anime (or manga, when [`search_manga`] is wired in later) returned by
/// Jikan. Fields beyond what the SPA actually needs are dropped on parse —
/// extending later is purely additive.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MalAnime {
    pub mal_id: i64,
    pub title: String,
    #[serde(default)]
    pub title_english: Option<String>,
    #[serde(default)]
    pub title_japanese: Option<String>,
    #[serde(default)]
    pub synopsis: Option<String>,
    pub url: String,
    #[serde(default)]
    pub images: Option<MalImages>,
    /// "TV", "Movie", "OVA", "Special", "Manga", "Novel", … (free-form).
    #[serde(default, rename = "type")]
    pub kind: Option<String>,
    #[serde(default)]
    pub year: Option<i32>,
    #[serde(default)]
    pub status: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MalCharacter {
    pub mal_id: i64,
    pub name: String,
    #[serde(default)]
    pub name_kanji: Option<String>,
    #[serde(default)]
    pub nicknames: Vec<String>,
    #[serde(default)]
    pub about: Option<String>,
    pub url: String,
    #[serde(default)]
    pub images: Option<MalImages>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MalImages {
    /// Most reliable variant — JPEG always populated. WebP often missing.
    pub jpg: Option<MalImageSet>,
    #[serde(default)]
    pub webp: Option<MalImageSet>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MalImageSet {
    #[serde(default)]
    pub image_url: Option<String>,
    #[serde(default)]
    pub large_image_url: Option<String>,
    #[serde(default)]
    pub small_image_url: Option<String>,
}

impl MalImages {
    /// Pick the best available URL: WebP large → JPG large → JPG default.
    #[allow(dead_code)]
    pub fn best(&self) -> Option<String> {
        if let Some(w) = &self.webp {
            if let Some(u) = w.large_image_url.clone().or_else(|| w.image_url.clone()) {
                return Some(u);
            }
        }
        if let Some(j) = &self.jpg {
            if let Some(u) = j.large_image_url.clone().or_else(|| j.image_url.clone()) {
                return Some(u);
            }
        }
        None
    }
}

// -----------------------------------------------------------------------------
// Search + detail (anime)
// -----------------------------------------------------------------------------

#[derive(Deserialize)]
struct ListResponse<T> {
    data: Vec<T>,
}

#[derive(Deserialize)]
struct DetailResponse<T> {
    data: T,
}

/// Search anime by title. Cached for 24h by lowercased query.
pub async fn search_anime(
    pool: &PgPool,
    http: &reqwest::Client,
    query: &str,
) -> AppResult<Vec<MalAnime>> {
    let trimmed = query.trim();
    if trimmed.len() < 2 {
        return Ok(Vec::new());
    }
    let cache_key = format!("search:anime:{}", trimmed.to_lowercase());
    let http = http.clone();
    let q = trimmed.to_string();

    cache::cached_fetch(
        pool,
        PROVIDER,
        "anime-search",
        &cache_key,
        Duration::hours(CACHE_TTL_HOURS),
        move || async move {
            let url = format!("{ENDPOINT}/anime");
            let resp: ListResponse<MalAnime> = http
                .get(&url)
                .query(&[("q", q.as_str()), ("limit", "15"), ("sfw", "false")])
                .timeout(std::time::Duration::from_secs(SEARCH_TIMEOUT_SECS))
                .send()
                .await
                .map_err(|e| AppError::Internal(anyhow::anyhow!("Jikan request failed: {e}")))?
                .error_for_status()
                .map_err(|e| AppError::Internal(anyhow::anyhow!("Jikan HTTP error: {e}")))?
                .json()
                .await
                .map_err(|e| AppError::Internal(anyhow::anyhow!("Jikan JSON parse failed: {e}")))?;
            Ok(resp.data)
        },
    )
    .await
}

/// Fetch a single anime by its MAL id. Cached for 24h.
pub async fn get_anime(
    pool: &PgPool,
    http: &reqwest::Client,
    id: i64,
) -> AppResult<MalAnime> {
    let http = http.clone();
    cache::cached_fetch(
        pool,
        PROVIDER,
        "anime",
        &id.to_string(),
        Duration::hours(CACHE_TTL_HOURS),
        move || async move {
            let url = format!("{ENDPOINT}/anime/{id}");
            let resp: DetailResponse<MalAnime> = http
                .get(&url)
                .timeout(std::time::Duration::from_secs(SEARCH_TIMEOUT_SECS))
                .send()
                .await
                .map_err(|e| AppError::Internal(anyhow::anyhow!("Jikan request failed: {e}")))?
                .error_for_status()
                .map_err(|e| {
                    if e.status() == Some(reqwest::StatusCode::NOT_FOUND) {
                        AppError::NotFound
                    } else {
                        AppError::Internal(anyhow::anyhow!("Jikan HTTP error: {e}"))
                    }
                })?
                .json()
                .await
                .map_err(|e| AppError::Internal(anyhow::anyhow!("Jikan JSON parse failed: {e}")))?;
            Ok(resp.data)
        },
    )
    .await
}

// -----------------------------------------------------------------------------
// Search + detail (character)
// -----------------------------------------------------------------------------

pub async fn search_character(
    pool: &PgPool,
    http: &reqwest::Client,
    query: &str,
) -> AppResult<Vec<MalCharacter>> {
    let trimmed = query.trim();
    if trimmed.len() < 2 {
        return Ok(Vec::new());
    }
    let cache_key = format!("search:character:{}", trimmed.to_lowercase());
    let http = http.clone();
    let q = trimmed.to_string();

    cache::cached_fetch(
        pool,
        PROVIDER,
        "character-search",
        &cache_key,
        Duration::hours(CACHE_TTL_HOURS),
        move || async move {
            let url = format!("{ENDPOINT}/characters");
            let resp: ListResponse<MalCharacter> = http
                .get(&url)
                .query(&[("q", q.as_str()), ("limit", "15")])
                .timeout(std::time::Duration::from_secs(SEARCH_TIMEOUT_SECS))
                .send()
                .await
                .map_err(|e| AppError::Internal(anyhow::anyhow!("Jikan request failed: {e}")))?
                .error_for_status()
                .map_err(|e| AppError::Internal(anyhow::anyhow!("Jikan HTTP error: {e}")))?
                .json()
                .await
                .map_err(|e| AppError::Internal(anyhow::anyhow!("Jikan JSON parse failed: {e}")))?;
            Ok(resp.data)
        },
    )
    .await
}

pub async fn get_character(
    pool: &PgPool,
    http: &reqwest::Client,
    id: i64,
) -> AppResult<MalCharacter> {
    let http = http.clone();
    cache::cached_fetch(
        pool,
        PROVIDER,
        "character",
        &id.to_string(),
        Duration::hours(CACHE_TTL_HOURS),
        move || async move {
            let url = format!("{ENDPOINT}/characters/{id}");
            let resp: DetailResponse<MalCharacter> = http
                .get(&url)
                .timeout(std::time::Duration::from_secs(SEARCH_TIMEOUT_SECS))
                .send()
                .await
                .map_err(|e| AppError::Internal(anyhow::anyhow!("Jikan request failed: {e}")))?
                .error_for_status()
                .map_err(|e| {
                    if e.status() == Some(reqwest::StatusCode::NOT_FOUND) {
                        AppError::NotFound
                    } else {
                        AppError::Internal(anyhow::anyhow!("Jikan HTTP error: {e}"))
                    }
                })?
                .json()
                .await
                .map_err(|e| AppError::Internal(anyhow::anyhow!("Jikan JSON parse failed: {e}")))?;
            Ok(resp.data)
        },
    )
    .await
}

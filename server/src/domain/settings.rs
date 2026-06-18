//! App-wide settings — a small key/value table for admin-tunable policies.
//!
//! - `gsplat.creation_policy`: who may create 3D / Gaussian-splat scans (3D
//!   training is GPU-heavy, so an admin may restrict it to admins only).
//! - `cote.price_cron`: 5-field cron schedule (UTC) for the price-refresh job
//!   that feeds the "cote" market value; empty disables it. See
//!   [`crate::services::price_cron`].
//!
//! Values live in `app_settings`; an absent row means the coded default.

use crate::error::AppResult;
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use std::str::FromStr as _;

const GSPLAT_POLICY_KEY: &str = "gsplat.creation_policy";

/// Anyone authenticated may create a gsplat scan.
pub const POLICY_EVERYONE: &str = "everyone";
/// Only admins may create a gsplat scan.
pub const POLICY_ADMINS_ONLY: &str = "admins_only";
/// Default before an admin sets one — admins-only (gsplat is GPU-heavy).
const GSPLAT_POLICY_DEFAULT: &str = POLICY_ADMINS_ONLY;

/// 5-field cron schedule (UTC) driving the cote price-refresh job. Empty
/// disables the feature.
const PRICE_CRON_KEY: &str = "cote.price_cron";
const PRICE_CRON_DEFAULT: &str = "";

pub fn is_valid_gsplat_policy(value: &str) -> bool {
    matches!(value, POLICY_EVERYONE | POLICY_ADMINS_ONLY)
}

/// A price-cron value is valid when empty (feature disabled) or a parseable
/// 5-field cron expression.
pub fn is_valid_price_cron(value: &str) -> bool {
    let trimmed = value.trim();
    trimmed.is_empty() || croner::Cron::from_str(trimmed).is_ok()
}

/// The current "who can create gsplat scans" policy, falling back to the
/// default when unset.
pub async fn gsplat_creation_policy(pool: &PgPool) -> AppResult<String> {
    let value: Option<String> = sqlx::query_scalar("SELECT value FROM app_settings WHERE key = $1")
        .bind(GSPLAT_POLICY_KEY)
        .fetch_optional(pool)
        .await?;
    Ok(value.unwrap_or_else(|| GSPLAT_POLICY_DEFAULT.to_string()))
}

/// True when only admins may create gsplat scans (the enforcement shortcut).
pub async fn gsplat_admins_only(pool: &PgPool) -> AppResult<bool> {
    Ok(gsplat_creation_policy(pool).await? == POLICY_ADMINS_ONLY)
}

pub async fn set_gsplat_creation_policy(pool: &PgPool, policy: &str) -> AppResult<()> {
    sqlx::query(
        "INSERT INTO app_settings (key, value, updated_at)
         VALUES ($1, $2, now())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()",
    )
    .bind(GSPLAT_POLICY_KEY)
    .bind(policy)
    .execute(pool)
    .await?;
    Ok(())
}

/// The cron schedule driving the price-refresh job, or `""` (disabled) when unset.
pub async fn price_cron_schedule(pool: &PgPool) -> AppResult<String> {
    let value: Option<String> = sqlx::query_scalar("SELECT value FROM app_settings WHERE key = $1")
        .bind(PRICE_CRON_KEY)
        .fetch_optional(pool)
        .await?;
    Ok(value.unwrap_or_else(|| PRICE_CRON_DEFAULT.to_string()))
}

pub async fn set_price_cron_schedule(pool: &PgPool, schedule: &str) -> AppResult<()> {
    sqlx::query(
        "INSERT INTO app_settings (key, value, updated_at)
         VALUES ($1, $2, now())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()",
    )
    .bind(PRICE_CRON_KEY)
    .bind(schedule)
    .execute(pool)
    .await?;
    Ok(())
}

/// Whether photo (visual) search is exposed to users. Off by default — it
/// needs a catalog embedding index, built by an `embed`-capable worker.
const VISUAL_SEARCH_KEY: &str = "visual_search.enabled";

pub async fn visual_search_enabled(pool: &PgPool) -> AppResult<bool> {
    let value: Option<String> = sqlx::query_scalar("SELECT value FROM app_settings WHERE key = $1")
        .bind(VISUAL_SEARCH_KEY)
        .fetch_optional(pool)
        .await?;
    Ok(value.as_deref() == Some("true"))
}

pub async fn set_visual_search_enabled(pool: &PgPool, enabled: bool) -> AppResult<()> {
    sqlx::query(
        "INSERT INTO app_settings (key, value, updated_at)
         VALUES ($1, $2, now())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()",
    )
    .bind(VISUAL_SEARCH_KEY)
    .bind(if enabled { "true" } else { "false" })
    .execute(pool)
    .await?;
    Ok(())
}

/// External (off-device) photo-search fallback — when the in-catalog search
/// finds nothing, the user may opt in to a reverse-image lookup via Google
/// Cloud Vision (Web Detection). This is the ONLY path where the photo leaves
/// the device, so it's gated by a distinct admin toggle AND a configured key,
/// on top of the parent `visual_search` flag.
const VISUAL_SEARCH_EXTERNAL_KEY: &str = "visual_search.external.enabled";
/// The Google Cloud Vision API key. A secret: stored here (same trust boundary
/// as the rest of `app_settings`) but NEVER returned by the API — the admin
/// view only exposes whether one is set.
const VISUAL_SEARCH_EXTERNAL_API_KEY: &str = "visual_search.external.google_api_key";

pub async fn visual_search_external_enabled(pool: &PgPool) -> AppResult<bool> {
    let value: Option<String> = sqlx::query_scalar("SELECT value FROM app_settings WHERE key = $1")
        .bind(VISUAL_SEARCH_EXTERNAL_KEY)
        .fetch_optional(pool)
        .await?;
    Ok(value.as_deref() == Some("true"))
}

pub async fn set_visual_search_external_enabled(pool: &PgPool, enabled: bool) -> AppResult<()> {
    sqlx::query(
        "INSERT INTO app_settings (key, value, updated_at)
         VALUES ($1, $2, now())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()",
    )
    .bind(VISUAL_SEARCH_EXTERNAL_KEY)
    .bind(if enabled { "true" } else { "false" })
    .execute(pool)
    .await?;
    Ok(())
}

/// The configured Google Vision API key, or `None` when unset/blank.
pub async fn visual_search_external_api_key(pool: &PgPool) -> AppResult<Option<String>> {
    let value: Option<String> = sqlx::query_scalar("SELECT value FROM app_settings WHERE key = $1")
        .bind(VISUAL_SEARCH_EXTERNAL_API_KEY)
        .fetch_optional(pool)
        .await?;
    Ok(value.filter(|s| !s.trim().is_empty()))
}

pub async fn set_visual_search_external_api_key(pool: &PgPool, key: &str) -> AppResult<()> {
    sqlx::query(
        "INSERT INTO app_settings (key, value, updated_at)
         VALUES ($1, $2, now())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()",
    )
    .bind(VISUAL_SEARCH_EXTERNAL_API_KEY)
    .bind(key.trim())
    .execute(pool)
    .await?;
    Ok(())
}

/// External fallback is usable: the parent feature is on, the admin enabled the
/// external fallback, AND a key is configured. The query path checks this
/// before ever forwarding a photo to Google.
pub async fn visual_search_external_ready(pool: &PgPool) -> AppResult<bool> {
    Ok(visual_search_enabled(pool).await?
        && visual_search_external_enabled(pool).await?
        && visual_search_external_api_key(pool).await?.is_some())
}

const VISUAL_SEARCH_SIMILARITY_KEY: &str = "visual_search.similarity_threshold";
/// Default match floor: a candidate must be ≥ 75 % similar to surface in the
/// "figurines proches" / "recommandé pour toi" rails. Admin-tunable.
const VISUAL_SEARCH_SIMILARITY_DEFAULT: f64 = 75.0;

/// The minimum similarity (0–100 %) a catalogue figure must reach to count as a
/// "close" match in the discovery rails. Lower = looser (more, weaker matches);
/// higher = stricter. Callers convert it to a max cosine distance.
pub async fn visual_search_similarity_threshold(pool: &PgPool) -> AppResult<f64> {
    let value: Option<String> = sqlx::query_scalar("SELECT value FROM app_settings WHERE key = $1")
        .bind(VISUAL_SEARCH_SIMILARITY_KEY)
        .fetch_optional(pool)
        .await?;
    Ok(value
        .and_then(|v| v.parse::<f64>().ok())
        .map(|v| v.clamp(0.0, 100.0))
        .unwrap_or(VISUAL_SEARCH_SIMILARITY_DEFAULT))
}

pub async fn set_visual_search_similarity_threshold(pool: &PgPool, threshold: f64) -> AppResult<()> {
    let clamped = threshold.clamp(0.0, 100.0);
    sqlx::query(
        "INSERT INTO app_settings (key, value, updated_at)
         VALUES ($1, $2, now())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()",
    )
    .bind(VISUAL_SEARCH_SIMILARITY_KEY)
    .bind(clamped.to_string())
    .execute(pool)
    .await?;
    Ok(())
}

const TEXT_SEARCH_MIN_MATCH_KEY: &str = "text_search.min_match";
/// Default semantic-match floor. 0 % keeps every top-K hit: e5 compresses cosine
/// similarity into a high, narrow band (~78–90 %), so a non-zero floor mainly
/// trims the weak tail rather than obvious junk. Admin-tunable.
const TEXT_SEARCH_MIN_MATCH_DEFAULT: f64 = 0.0;

/// The minimum similarity (0–100 %) a catalogue figure must reach to surface in
/// semantic ("Sens") search. The handler converts it to a max cosine distance,
/// exactly like the visual rails' similarity threshold.
pub async fn text_search_min_match(pool: &PgPool) -> AppResult<f64> {
    let value: Option<String> = sqlx::query_scalar("SELECT value FROM app_settings WHERE key = $1")
        .bind(TEXT_SEARCH_MIN_MATCH_KEY)
        .fetch_optional(pool)
        .await?;
    Ok(value
        .and_then(|v| v.parse::<f64>().ok())
        .map(|v| v.clamp(0.0, 100.0))
        .unwrap_or(TEXT_SEARCH_MIN_MATCH_DEFAULT))
}

pub async fn set_text_search_min_match(pool: &PgPool, threshold: f64) -> AppResult<()> {
    let clamped = threshold.clamp(0.0, 100.0);
    sqlx::query(
        "INSERT INTO app_settings (key, value, updated_at)
         VALUES ($1, $2, now())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()",
    )
    .bind(TEXT_SEARCH_MIN_MATCH_KEY)
    .bind(clamped.to_string())
    .execute(pool)
    .await?;
    Ok(())
}

const VISUAL_SEARCH_AMBIANCES_KEY: &str = "visual_search.ambiances_enabled";

/// Whether the "browse par ambiance" view (visual-style clustering) is offered.
/// Off by default — it only pays off on a large, varied catalogue, so an admin
/// opts in once the collection is big and diverse enough.
pub async fn visual_search_ambiances_enabled(pool: &PgPool) -> AppResult<bool> {
    let value: Option<String> = sqlx::query_scalar("SELECT value FROM app_settings WHERE key = $1")
        .bind(VISUAL_SEARCH_AMBIANCES_KEY)
        .fetch_optional(pool)
        .await?;
    Ok(value.as_deref() == Some("true"))
}

pub async fn set_visual_search_ambiances_enabled(pool: &PgPool, enabled: bool) -> AppResult<()> {
    sqlx::query(
        "INSERT INTO app_settings (key, value, updated_at)
         VALUES ($1, $2, now())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()",
    )
    .bind(VISUAL_SEARCH_AMBIANCES_KEY)
    .bind(enabled.to_string())
    .execute(pool)
    .await?;
    Ok(())
}

const TEXT_SEARCH_KEY: &str = "text_search.enabled";

/// Whether semantic (text) search is offered. Off by default — it needs the
/// text index built (worker) + the in-browser model, so an admin opts in.
pub async fn text_search_enabled(pool: &PgPool) -> AppResult<bool> {
    let value: Option<String> = sqlx::query_scalar("SELECT value FROM app_settings WHERE key = $1")
        .bind(TEXT_SEARCH_KEY)
        .fetch_optional(pool)
        .await?;
    Ok(value.as_deref() == Some("true"))
}

pub async fn set_text_search_enabled(pool: &PgPool, enabled: bool) -> AppResult<()> {
    sqlx::query(
        "INSERT INTO app_settings (key, value, updated_at)
         VALUES ($1, $2, now())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()",
    )
    .bind(TEXT_SEARCH_KEY)
    .bind(enabled.to_string())
    .execute(pool)
    .await?;
    Ok(())
}

const CLIP_SEARCH_KEY: &str = "clip_search.enabled";

/// Whether multimodal "search by look" (SigLIP) is offered. Off by default — it
/// needs the clip image index built (worker) + the in-browser text model, so an
/// admin opts in.
pub async fn clip_search_enabled(pool: &PgPool) -> AppResult<bool> {
    let value: Option<String> = sqlx::query_scalar("SELECT value FROM app_settings WHERE key = $1")
        .bind(CLIP_SEARCH_KEY)
        .fetch_optional(pool)
        .await?;
    Ok(value.as_deref() == Some("true"))
}

pub async fn set_clip_search_enabled(pool: &PgPool, enabled: bool) -> AppResult<()> {
    sqlx::query(
        "INSERT INTO app_settings (key, value, updated_at)
         VALUES ($1, $2, now())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()",
    )
    .bind(CLIP_SEARCH_KEY)
    .bind(enabled.to_string())
    .execute(pool)
    .await?;
    Ok(())
}

const CLIP_SEARCH_MIN_MATCH_KEY: &str = "clip_search.min_match";
const CLIP_SEARCH_MIN_MATCH_DEFAULT: f64 = 0.0;

/// Minimum similarity (0–100 %) for a figure to surface in "search by look".
/// SigLIP cosine sits in a low band, so the handler converts this to a max
/// distance the same way the other rails do. 0 % keeps every top-K hit.
pub async fn clip_search_min_match(pool: &PgPool) -> AppResult<f64> {
    let value: Option<String> = sqlx::query_scalar("SELECT value FROM app_settings WHERE key = $1")
        .bind(CLIP_SEARCH_MIN_MATCH_KEY)
        .fetch_optional(pool)
        .await?;
    Ok(value
        .and_then(|v| v.parse::<f64>().ok())
        .map(|v| v.clamp(0.0, 100.0))
        .unwrap_or(CLIP_SEARCH_MIN_MATCH_DEFAULT))
}

pub async fn set_clip_search_min_match(pool: &PgPool, threshold: f64) -> AppResult<()> {
    let clamped = threshold.clamp(0.0, 100.0);
    sqlx::query(
        "INSERT INTO app_settings (key, value, updated_at)
         VALUES ($1, $2, now())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()",
    )
    .bind(CLIP_SEARCH_MIN_MATCH_KEY)
    .bind(clamped.to_string())
    .execute(pool)
    .await?;
    Ok(())
}

/// The admin-facing settings view (extend as more settings are added).
#[derive(Debug, Serialize)]
pub struct Settings {
    pub gsplat_creation_policy: String,
    pub price_cron: String,
    pub visual_search: bool,
    pub visual_search_external: bool,
    /// Whether a Google Vision API key is configured (the key itself is never
    /// returned).
    pub visual_search_external_key_set: bool,
    /// Match floor for the discovery rails, as a percentage (0–100).
    pub visual_search_similarity_threshold: f64,
    /// Whether the "browse par ambiance" clustering view is offered.
    pub visual_search_ambiances: bool,
    /// Whether semantic text search is offered.
    pub text_search: bool,
    /// Match floor for semantic ("Sens") search, as a percentage (0–100).
    pub text_search_min_match: f64,
    /// Whether multimodal "search by look" (SigLIP) is offered.
    pub clip_search: bool,
    /// Match floor for "search by look", as a percentage (0–100).
    pub clip_search_min_match: f64,
}

#[derive(Debug, Deserialize)]
pub struct SettingsPatch {
    pub gsplat_creation_policy: Option<String>,
    pub price_cron: Option<String>,
    pub visual_search: Option<bool>,
    pub visual_search_external: Option<bool>,
    /// New Google Vision API key. `Some(non-empty)` sets it, `Some("")` clears
    /// it, `None` leaves it unchanged (so the admin UI never round-trips the
    /// secret).
    pub visual_search_external_key: Option<String>,
    /// New match floor (0–100 %); server clamps to range on write.
    pub visual_search_similarity_threshold: Option<f64>,
    pub visual_search_ambiances: Option<bool>,
    pub text_search: Option<bool>,
    /// New semantic-match floor (0–100 %); server clamps to range on write.
    pub text_search_min_match: Option<f64>,
    pub clip_search: Option<bool>,
    /// New "search by look" match floor (0–100 %); server clamps on write.
    pub clip_search_min_match: Option<f64>,
}

pub async fn all(pool: &PgPool) -> AppResult<Settings> {
    Ok(Settings {
        gsplat_creation_policy: gsplat_creation_policy(pool).await?,
        price_cron: price_cron_schedule(pool).await?,
        visual_search: visual_search_enabled(pool).await?,
        visual_search_external: visual_search_external_enabled(pool).await?,
        visual_search_external_key_set: visual_search_external_api_key(pool).await?.is_some(),
        visual_search_similarity_threshold: visual_search_similarity_threshold(pool).await?,
        visual_search_ambiances: visual_search_ambiances_enabled(pool).await?,
        text_search: text_search_enabled(pool).await?,
        text_search_min_match: text_search_min_match(pool).await?,
        clip_search: clip_search_enabled(pool).await?,
        clip_search_min_match: clip_search_min_match(pool).await?,
    })
}

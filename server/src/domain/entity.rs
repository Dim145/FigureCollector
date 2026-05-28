//! Manufacturer / Series / Character entities.
//!
//! Each of these used to be a near-empty FK target table populated only by
//! the figure-create upsert. Migration 011 promoted them to first-class
//! entities with metadata (description, image, AniList / MAL ids, external
//! URL), and this module exposes:
//!
//!   - find / list operations used by `/api/{kind}/:slug` pages and the
//!     admin catalog editor
//!   - admin-only PATCH that updates any subset of the metadata fields
//!   - `figures_for_*` queries that return the catalog rows linked to the
//!     entity (filtered for NSFW the same way `figure::list` is)
//!
//! Image resolution: the API exposes a single `image_url` field per entity,
//! computed from `image_key` (if a Garage upload exists) or the legacy
//! external URL column (`logo_url` / `cover_url` / `portrait_url`).

use crate::error::{AppError, AppResult};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, PgPool};
use uuid::Uuid;

use super::figure::Figure;

/// Pluralised path segment for the entity-image proxy. Kept here so the
/// routes module + the view helpers stay in sync.
pub const KIND_MANUFACTURER: &str = "manufacturers";
pub const KIND_SERIES: &str = "series";
pub const KIND_CHARACTER: &str = "characters";

// =============================================================================
// Manufacturer
// =============================================================================

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct Manufacturer {
    pub id: Uuid,
    pub name: String,
    pub slug: String,
    pub country: Option<String>,
    /// External URL (admin paste or auto-fill from AniList / orzgk).
    pub logo_url: Option<String>,
    /// Garage object key — when present, [`Self::image_url`] resolves to a
    /// signed/public URL instead of [`Self::logo_url`].
    pub image_key: Option<String>,
    pub description: Option<String>,
    pub website_url: Option<String>,
    pub created_at: DateTime<Utc>,
    /// Computed: number of figures linked to this manufacturer. Populated
    /// only by list / find_by_slug — leave at 0 elsewhere.
    #[sqlx(default)]
    pub figure_count: i64,
}

/// Public-API shape: the entity row plus a resolved `image_url` and a
/// counted set of figures.
#[derive(Debug, Clone, Serialize)]
pub struct ManufacturerView {
    #[serde(flatten)]
    pub manufacturer: Manufacturer,
    pub image_url: Option<String>,
}

impl ManufacturerView {
    pub fn from(m: Manufacturer) -> Self {
        let image_url = resolve_image(KIND_MANUFACTURER, m.id, &m.image_key, m.logo_url.as_deref());
        Self { manufacturer: m, image_url }
    }
}

pub async fn find_manufacturer_by_slug(pool: &PgPool, slug: &str) -> AppResult<Option<Manufacturer>> {
    let row = sqlx::query_as::<_, Manufacturer>(
        "SELECT m.id, m.name, m.slug, m.country, m.logo_url, m.image_key, \
                m.description, m.website_url, m.created_at, \
                (SELECT COUNT(*)::bigint FROM figures WHERE manufacturer_id = m.id) \
                  AS figure_count \
         FROM manufacturers m WHERE m.slug = $1",
    )
    .bind(slug)
    .fetch_optional(pool)
    .await?;
    Ok(row)
}

/// Lightweight `{id, name, slug}` rows for the figure-form manufacturer
/// autocomplete. Same shape + cap as [`list_series_lookup`].
#[derive(Debug, Clone, Serialize, FromRow)]
pub struct ManufacturerLookup {
    pub id: Uuid,
    pub name: String,
    pub slug: String,
}

pub async fn list_manufacturers_lookup(pool: &PgPool) -> AppResult<Vec<ManufacturerLookup>> {
    Ok(sqlx::query_as::<_, ManufacturerLookup>(
        "SELECT id, name, slug FROM manufacturers ORDER BY name ASC LIMIT 1000",
    )
    .fetch_all(pool)
    .await?)
}

/// Sculptors have no slug-based public page (yet) but we still expose
/// `slug` so the autocomplete row keys are stable.
#[derive(Debug, Clone, Serialize, FromRow)]
pub struct SculptorLookup {
    pub id: Uuid,
    pub name: String,
    pub slug: String,
}

pub async fn list_sculptors_lookup(pool: &PgPool) -> AppResult<Vec<SculptorLookup>> {
    Ok(sqlx::query_as::<_, SculptorLookup>(
        "SELECT id, name, slug FROM sculptors ORDER BY name ASC LIMIT 1000",
    )
    .fetch_all(pool)
    .await?)
}

/// Distinct material names previously used on any figure. Powers the
/// `materials` field's per-token autocomplete in the figure form.
/// Returns plain strings — materials are not a separate entity, just a
/// `text[]` column on `figures`. We pre-trim + ignore blanks here so the
/// frontend gets a clean alphabetical list.
pub async fn list_materials_lookup(pool: &PgPool) -> AppResult<Vec<String>> {
    let rows: Vec<(String,)> = sqlx::query_as(
        "SELECT DISTINCT trim(m) AS name \
         FROM figures, unnest(materials) AS m \
         WHERE trim(m) <> '' \
         ORDER BY name ASC \
         LIMIT 200",
    )
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(|(n,)| n).collect())
}

pub async fn list_manufacturers(
    pool: &PgPool,
    q: Option<&str>,
    limit: i64,
    offset: i64,
) -> AppResult<Vec<Manufacturer>> {
    let pattern = q.map(|s| format!("%{}%", s));
    let rows = sqlx::query_as::<_, Manufacturer>(
        "SELECT m.id, m.name, m.slug, m.country, m.logo_url, m.image_key, \
                m.description, m.website_url, m.created_at, \
                (SELECT COUNT(*)::bigint FROM figures WHERE manufacturer_id = m.id) \
                  AS figure_count \
         FROM manufacturers m \
         WHERE ($1::text IS NULL OR m.name ILIKE $1) \
         ORDER BY m.name ASC \
         LIMIT $2 OFFSET $3",
    )
    .bind(pattern)
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

pub async fn figures_for_manufacturer(
    pool: &PgPool,
    id: Uuid,
    exclude_nsfw: bool,
) -> AppResult<Vec<Figure>> {
    let mut sql = String::from(
        "SELECT f.id, f.name, f.slug, f.manufacturer_id, f.sculptor_id, f.figure_type, f.scale, \
                f.height_mm, f.materials, f.release_date, f.msrp_amount, f.msrp_currency, f.jan, \
                f.exclusivity, f.edition, f.version_name, f.official_image_url, f.description, \
                f.mfc_id, f.created_by, f.is_user_submitted, f.is_nsfw, f.created_at, f.updated_at, \
                (SELECT fp.id FROM figure_photos fp \
                 WHERE fp.figure_id = f.id \
                 ORDER BY fp.is_primary DESC, fp.position ASC, fp.created_at ASC \
                 LIMIT 1) AS primary_photo_id \
         FROM figures f \
         WHERE f.manufacturer_id = $1",
    );
    if exclude_nsfw {
        sql.push_str(" AND NOT f.is_nsfw");
    }
    sql.push_str(" ORDER BY f.created_at DESC LIMIT 200");
    Ok(sqlx::query_as::<_, Figure>(&sql).bind(id).fetch_all(pool).await?)
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct ManufacturerPatch {
    pub name: Option<String>,
    pub country: Option<String>,
    pub logo_url: Option<String>,
    pub image_key: Option<String>,
    pub description: Option<String>,
    pub website_url: Option<String>,
}

pub async fn patch_manufacturer(
    pool: &PgPool,
    id: Uuid,
    input: ManufacturerPatch,
) -> AppResult<Manufacturer> {
    sqlx::query(
        "UPDATE manufacturers SET
            name        = COALESCE($1, name),
            country     = COALESCE($2, country),
            logo_url    = COALESCE($3, logo_url),
            image_key   = COALESCE($4, image_key),
            description = COALESCE($5, description),
            website_url = COALESCE($6, website_url)
         WHERE id = $7",
    )
    .bind(&input.name)
    .bind(&input.country)
    .bind(&input.logo_url)
    .bind(&input.image_key)
    .bind(&input.description)
    .bind(&input.website_url)
    .bind(id)
    .execute(pool)
    .await?;
    sqlx::query_as::<_, Manufacturer>(
        "SELECT m.id, m.name, m.slug, m.country, m.logo_url, m.image_key, \
                m.description, m.website_url, m.created_at, \
                (SELECT COUNT(*)::bigint FROM figures WHERE manufacturer_id = m.id) \
                  AS figure_count \
         FROM manufacturers m WHERE m.id = $1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::NotFound)
}

// =============================================================================
// Series
// =============================================================================

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct Series {
    pub id: Uuid,
    pub name: String,
    pub slug: String,
    pub origin: String,
    pub anilist_id: Option<i32>,
    pub mal_id: Option<i32>,
    pub description: Option<String>,
    pub cover_url: Option<String>,
    pub external_url: Option<String>,
    pub image_key: Option<String>,
    pub created_at: DateTime<Utc>,
    #[sqlx(default)]
    pub figure_count: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct SeriesView {
    #[serde(flatten)]
    pub series: Series,
    pub image_url: Option<String>,
}

impl SeriesView {
    pub fn from(s: Series) -> Self {
        let image_url = resolve_image(KIND_SERIES, s.id, &s.image_key, s.cover_url.as_deref());
        Self { series: s, image_url }
    }
}

pub async fn find_series_by_slug(pool: &PgPool, slug: &str) -> AppResult<Option<Series>> {
    Ok(sqlx::query_as::<_, Series>(
        "SELECT s.id, s.name, s.slug, s.origin, s.anilist_id, s.mal_id, s.description, \
                s.cover_url, s.external_url, s.image_key, s.created_at, \
                (SELECT COUNT(*)::bigint FROM figure_series WHERE series_id = s.id) \
                  AS figure_count \
         FROM series s WHERE s.slug = $1",
    )
    .bind(slug)
    .fetch_optional(pool)
    .await?)
}

/// Lightweight `{id, name, slug}` rows for the public series autocomplete.
/// The figure form filters client-side, so we send the full registry in one
/// short payload and cache it aggressively. Cap kept generous — a personal
/// catalogue rarely climbs past a few hundred series.
#[derive(Debug, Clone, Serialize, FromRow)]
pub struct SeriesLookup {
    pub id: Uuid,
    pub name: String,
    pub slug: String,
}

pub async fn list_series_lookup(pool: &PgPool) -> AppResult<Vec<SeriesLookup>> {
    Ok(sqlx::query_as::<_, SeriesLookup>(
        "SELECT id, name, slug FROM series ORDER BY name ASC LIMIT 1000",
    )
    .fetch_all(pool)
    .await?)
}

pub async fn list_series(
    pool: &PgPool,
    q: Option<&str>,
    limit: i64,
    offset: i64,
) -> AppResult<Vec<Series>> {
    let pattern = q.map(|s| format!("%{}%", s));
    Ok(sqlx::query_as::<_, Series>(
        "SELECT s.id, s.name, s.slug, s.origin, s.anilist_id, s.mal_id, s.description, \
                s.cover_url, s.external_url, s.image_key, s.created_at, \
                (SELECT COUNT(*)::bigint FROM figure_series WHERE series_id = s.id) \
                  AS figure_count \
         FROM series s \
         WHERE ($1::text IS NULL OR s.name ILIKE $1) \
         ORDER BY s.name ASC \
         LIMIT $2 OFFSET $3",
    )
    .bind(pattern)
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await?)
}

pub async fn figures_for_series(
    pool: &PgPool,
    id: Uuid,
    exclude_nsfw: bool,
) -> AppResult<Vec<Figure>> {
    let mut sql = String::from(
        "SELECT f.id, f.name, f.slug, f.manufacturer_id, f.sculptor_id, f.figure_type, f.scale, \
                f.height_mm, f.materials, f.release_date, f.msrp_amount, f.msrp_currency, f.jan, \
                f.exclusivity, f.edition, f.version_name, f.official_image_url, f.description, \
                f.mfc_id, f.created_by, f.is_user_submitted, f.is_nsfw, f.created_at, f.updated_at, \
                (SELECT fp.id FROM figure_photos fp \
                 WHERE fp.figure_id = f.id \
                 ORDER BY fp.is_primary DESC, fp.position ASC, fp.created_at ASC \
                 LIMIT 1) AS primary_photo_id \
         FROM figures f \
         JOIN figure_series fs ON fs.figure_id = f.id \
         WHERE fs.series_id = $1",
    );
    if exclude_nsfw {
        sql.push_str(" AND NOT f.is_nsfw");
    }
    sql.push_str(" ORDER BY f.release_date DESC NULLS LAST, f.created_at DESC LIMIT 200");
    Ok(sqlx::query_as::<_, Figure>(&sql).bind(id).fetch_all(pool).await?)
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct SeriesPatch {
    pub name: Option<String>,
    pub origin: Option<String>,
    pub anilist_id: Option<i32>,
    pub mal_id: Option<i32>,
    pub description: Option<String>,
    pub cover_url: Option<String>,
    pub external_url: Option<String>,
    pub image_key: Option<String>,
}

const SERIES_ORIGINS: &[&str] = &[
    "anime", "manga", "game", "vn", "light_novel", "original", "other",
];

pub async fn patch_series(pool: &PgPool, id: Uuid, input: SeriesPatch) -> AppResult<Series> {
    if let Some(o) = &input.origin {
        if !SERIES_ORIGINS.contains(&o.as_str()) {
            return Err(AppError::BadRequest("invalid series origin"));
        }
    }
    sqlx::query(
        "UPDATE series SET
            name         = COALESCE($1, name),
            origin       = COALESCE($2, origin),
            anilist_id   = COALESCE($3, anilist_id),
            mal_id       = COALESCE($4, mal_id),
            description  = COALESCE($5, description),
            cover_url    = COALESCE($6, cover_url),
            external_url = COALESCE($7, external_url),
            image_key    = COALESCE($8, image_key)
         WHERE id = $9",
    )
    .bind(&input.name)
    .bind(&input.origin)
    .bind(input.anilist_id)
    .bind(input.mal_id)
    .bind(&input.description)
    .bind(&input.cover_url)
    .bind(&input.external_url)
    .bind(&input.image_key)
    .bind(id)
    .execute(pool)
    .await?;
    sqlx::query_as::<_, Series>(
        "SELECT s.id, s.name, s.slug, s.origin, s.anilist_id, s.mal_id, s.description, \
                s.cover_url, s.external_url, s.image_key, s.created_at, \
                (SELECT COUNT(*)::bigint FROM figure_series WHERE series_id = s.id) \
                  AS figure_count \
         FROM series s WHERE s.id = $1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::NotFound)
}

// =============================================================================
// Character
// =============================================================================

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct Character {
    pub id: Uuid,
    pub name: String,
    pub slug: String,
    pub series_id: Option<Uuid>,
    pub anilist_id: Option<i32>,
    pub mal_id: Option<i32>,
    pub description: Option<String>,
    pub portrait_url: Option<String>,
    pub external_url: Option<String>,
    pub image_key: Option<String>,
    pub created_at: DateTime<Utc>,
    #[sqlx(default)]
    pub figure_count: i64,
    /// Joined series name when one is linked. Empty otherwise.
    #[sqlx(default)]
    pub series_name: Option<String>,
    #[sqlx(default)]
    pub series_slug: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct CharacterView {
    #[serde(flatten)]
    pub character: Character,
    pub image_url: Option<String>,
}

impl CharacterView {
    pub fn from(c: Character) -> Self {
        let image_url = resolve_image(KIND_CHARACTER, c.id, &c.image_key, c.portrait_url.as_deref());
        Self { character: c, image_url }
    }
}

pub async fn find_character_by_slug(pool: &PgPool, slug: &str) -> AppResult<Option<Character>> {
    Ok(sqlx::query_as::<_, Character>(
        "SELECT c.id, c.name, c.slug, c.series_id, c.anilist_id, c.mal_id, c.description, \
                c.portrait_url, c.external_url, c.image_key, c.created_at, \
                (SELECT COUNT(*)::bigint FROM figure_characters WHERE character_id = c.id) \
                  AS figure_count, \
                s.name AS series_name, s.slug AS series_slug \
         FROM characters c \
         LEFT JOIN series s ON s.id = c.series_id \
         WHERE c.slug = $1",
    )
    .bind(slug)
    .fetch_optional(pool)
    .await?)
}

/// Lightweight character row for the autocomplete dropdown. The joined
/// `series_name` makes disambiguation obvious in the UI ("Saber — Fate/stay
/// night" vs. another Saber), without forcing the heavier
/// [`list_characters`] payload.
#[derive(Debug, Clone, Serialize, FromRow)]
pub struct CharacterLookup {
    pub id: Uuid,
    pub name: String,
    pub slug: String,
    pub series_name: Option<String>,
}

pub async fn list_characters_lookup(pool: &PgPool) -> AppResult<Vec<CharacterLookup>> {
    Ok(sqlx::query_as::<_, CharacterLookup>(
        "SELECT c.id, c.name, c.slug, s.name AS series_name \
         FROM characters c \
         LEFT JOIN series s ON s.id = c.series_id \
         ORDER BY c.name ASC LIMIT 2000",
    )
    .fetch_all(pool)
    .await?)
}

pub async fn list_characters(
    pool: &PgPool,
    q: Option<&str>,
    limit: i64,
    offset: i64,
) -> AppResult<Vec<Character>> {
    let pattern = q.map(|s| format!("%{}%", s));
    Ok(sqlx::query_as::<_, Character>(
        "SELECT c.id, c.name, c.slug, c.series_id, c.anilist_id, c.mal_id, c.description, \
                c.portrait_url, c.external_url, c.image_key, c.created_at, \
                (SELECT COUNT(*)::bigint FROM figure_characters WHERE character_id = c.id) \
                  AS figure_count, \
                s.name AS series_name, s.slug AS series_slug \
         FROM characters c \
         LEFT JOIN series s ON s.id = c.series_id \
         WHERE ($1::text IS NULL OR c.name ILIKE $1) \
         ORDER BY c.name ASC \
         LIMIT $2 OFFSET $3",
    )
    .bind(pattern)
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await?)
}

pub async fn figures_for_character(
    pool: &PgPool,
    id: Uuid,
    exclude_nsfw: bool,
) -> AppResult<Vec<Figure>> {
    let mut sql = String::from(
        "SELECT f.id, f.name, f.slug, f.manufacturer_id, f.sculptor_id, f.figure_type, f.scale, \
                f.height_mm, f.materials, f.release_date, f.msrp_amount, f.msrp_currency, f.jan, \
                f.exclusivity, f.edition, f.version_name, f.official_image_url, f.description, \
                f.mfc_id, f.created_by, f.is_user_submitted, f.is_nsfw, f.created_at, f.updated_at, \
                (SELECT fp.id FROM figure_photos fp \
                 WHERE fp.figure_id = f.id \
                 ORDER BY fp.is_primary DESC, fp.position ASC, fp.created_at ASC \
                 LIMIT 1) AS primary_photo_id \
         FROM figures f \
         JOIN figure_characters fc ON fc.figure_id = f.id \
         WHERE fc.character_id = $1",
    );
    if exclude_nsfw {
        sql.push_str(" AND NOT f.is_nsfw");
    }
    sql.push_str(" ORDER BY f.release_date DESC NULLS LAST, f.created_at DESC LIMIT 200");
    Ok(sqlx::query_as::<_, Figure>(&sql).bind(id).fetch_all(pool).await?)
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct CharacterPatch {
    pub name: Option<String>,
    pub series_id: Option<Uuid>,
    pub anilist_id: Option<i32>,
    pub mal_id: Option<i32>,
    pub description: Option<String>,
    pub portrait_url: Option<String>,
    pub external_url: Option<String>,
    pub image_key: Option<String>,
}

pub async fn patch_character(
    pool: &PgPool,
    id: Uuid,
    input: CharacterPatch,
) -> AppResult<Character> {
    sqlx::query(
        "UPDATE characters SET
            name         = COALESCE($1, name),
            series_id    = COALESCE($2, series_id),
            anilist_id   = COALESCE($3, anilist_id),
            mal_id       = COALESCE($4, mal_id),
            description  = COALESCE($5, description),
            portrait_url = COALESCE($6, portrait_url),
            external_url = COALESCE($7, external_url),
            image_key    = COALESCE($8, image_key)
         WHERE id = $9",
    )
    .bind(&input.name)
    .bind(input.series_id)
    .bind(input.anilist_id)
    .bind(input.mal_id)
    .bind(&input.description)
    .bind(&input.portrait_url)
    .bind(&input.external_url)
    .bind(&input.image_key)
    .bind(id)
    .execute(pool)
    .await?;
    sqlx::query_as::<_, Character>(
        "SELECT c.id, c.name, c.slug, c.series_id, c.anilist_id, c.mal_id, c.description, \
                c.portrait_url, c.external_url, c.image_key, c.created_at, \
                (SELECT COUNT(*)::bigint FROM figure_characters WHERE character_id = c.id) \
                  AS figure_count, \
                s.name AS series_name, s.slug AS series_slug \
         FROM characters c \
         LEFT JOIN series s ON s.id = c.series_id \
         WHERE c.id = $1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::NotFound)
}

// =============================================================================
// Bulk link/unlink/move (admin) — figures × series, figures × characters
// =============================================================================
//
// All four operations run inside a single transaction so a partial failure
// (e.g. one bad figure_id in a batch) never leaves the join table half-
// updated. The "move" operations use INSERT ON CONFLICT DO NOTHING + DELETE
// pattern because (figure_id, series_id) and (figure_id, character_id) are
// composite primary keys — a straight UPDATE would explode if the figure
// was already linked to the target.

/// Remove the given figures from a series' join table. Returns the row
/// count actually deleted (so callers can detect "figure_id wasn't linked").
pub async fn unlink_figures_from_series(
    pool: &PgPool,
    series_id: Uuid,
    figure_ids: &[Uuid],
) -> AppResult<u64> {
    if figure_ids.is_empty() {
        return Ok(0);
    }
    let res = sqlx::query(
        "DELETE FROM figure_series WHERE series_id = $1 AND figure_id = ANY($2)",
    )
    .bind(series_id)
    .bind(figure_ids)
    .execute(pool)
    .await?;
    Ok(res.rows_affected())
}

pub async fn unlink_figures_from_character(
    pool: &PgPool,
    character_id: Uuid,
    figure_ids: &[Uuid],
) -> AppResult<u64> {
    if figure_ids.is_empty() {
        return Ok(0);
    }
    let res = sqlx::query(
        "DELETE FROM figure_characters WHERE character_id = $1 AND figure_id = ANY($2)",
    )
    .bind(character_id)
    .bind(figure_ids)
    .execute(pool)
    .await?;
    Ok(res.rows_affected())
}

/// Move figures from one series to another. INSERTs the new link first
/// (with `ON CONFLICT DO NOTHING` so a figure already in the target survives),
/// then DELETEs the old link in the same transaction.
pub async fn move_figures_between_series(
    pool: &PgPool,
    from_series: Uuid,
    to_series: Uuid,
    figure_ids: &[Uuid],
) -> AppResult<u64> {
    if figure_ids.is_empty() {
        return Ok(0);
    }
    if from_series == to_series {
        return Err(AppError::BadRequest("source and target series are the same"));
    }
    // Confirm the target exists so we 404 cleanly instead of relying on a FK
    // violation buried in the move INSERT.
    let target_exists: (bool,) =
        sqlx::query_as("SELECT EXISTS(SELECT 1 FROM series WHERE id = $1)")
            .bind(to_series)
            .fetch_one(pool)
            .await?;
    if !target_exists.0 {
        return Err(AppError::NotFound);
    }

    let mut tx = pool.begin().await?;
    sqlx::query(
        "INSERT INTO figure_series (figure_id, series_id)
         SELECT figure_id, $2 FROM figure_series
          WHERE series_id = $1 AND figure_id = ANY($3)
         ON CONFLICT (figure_id, series_id) DO NOTHING",
    )
    .bind(from_series)
    .bind(to_series)
    .bind(figure_ids)
    .execute(&mut *tx)
    .await?;
    let res = sqlx::query(
        "DELETE FROM figure_series WHERE series_id = $1 AND figure_id = ANY($2)",
    )
    .bind(from_series)
    .bind(figure_ids)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(res.rows_affected())
}

pub async fn move_figures_between_characters(
    pool: &PgPool,
    from_character: Uuid,
    to_character: Uuid,
    figure_ids: &[Uuid],
) -> AppResult<u64> {
    if figure_ids.is_empty() {
        return Ok(0);
    }
    if from_character == to_character {
        return Err(AppError::BadRequest(
            "source and target characters are the same",
        ));
    }
    let target_exists: (bool,) =
        sqlx::query_as("SELECT EXISTS(SELECT 1 FROM characters WHERE id = $1)")
            .bind(to_character)
            .fetch_one(pool)
            .await?;
    if !target_exists.0 {
        return Err(AppError::NotFound);
    }

    let mut tx = pool.begin().await?;
    sqlx::query(
        "INSERT INTO figure_characters (figure_id, character_id)
         SELECT figure_id, $2 FROM figure_characters
          WHERE character_id = $1 AND figure_id = ANY($3)
         ON CONFLICT (figure_id, character_id) DO NOTHING",
    )
    .bind(from_character)
    .bind(to_character)
    .bind(figure_ids)
    .execute(&mut *tx)
    .await?;
    let res = sqlx::query(
        "DELETE FROM figure_characters WHERE character_id = $1 AND figure_id = ANY($2)",
    )
    .bind(from_character)
    .bind(figure_ids)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(res.rows_affected())
}

// =============================================================================
// Delete (admin) — with optional replacement = full merge semantics
// =============================================================================
//
// `delete_series(id, replacement=Some(other))` rewires every figure_series
// row to point at `other` (deduped via ON CONFLICT) AND moves every child
// `characters.series_id = id` to `other`. Then drops the row. Without a
// replacement, the existing FK cascades (figure_series ON DELETE CASCADE,
// characters.series_id ON DELETE SET NULL) handle the orphans.

pub async fn delete_series(
    pool: &PgPool,
    id: Uuid,
    replacement: Option<Uuid>,
) -> AppResult<()> {
    if Some(id) == replacement {
        return Err(AppError::BadRequest(
            "replacement series must differ from the one being deleted",
        ));
    }
    let mut tx = pool.begin().await?;
    if let Some(target) = replacement {
        // Cheap NotFound guard before touching the join tables.
        let target_exists: (bool,) =
            sqlx::query_as("SELECT EXISTS(SELECT 1 FROM series WHERE id = $1)")
                .bind(target)
                .fetch_one(&mut *tx)
                .await?;
        if !target_exists.0 {
            return Err(AppError::NotFound);
        }
        // Figures: re-point every link, ignoring duplicates with the target.
        sqlx::query(
            "INSERT INTO figure_series (figure_id, series_id)
             SELECT figure_id, $2 FROM figure_series WHERE series_id = $1
             ON CONFLICT (figure_id, series_id) DO NOTHING",
        )
        .bind(id)
        .bind(target)
        .execute(&mut *tx)
        .await?;
        // Characters: full merge — move them onto the replacement series.
        sqlx::query("UPDATE characters SET series_id = $2 WHERE series_id = $1")
            .bind(id)
            .bind(target)
            .execute(&mut *tx)
            .await?;
    }
    // Either way: drop the row. CASCADE deletes leftover figure_series rows
    // (without replacement) or, with replacement, the remaining `series_id =
    // old` rows that the INSERT already mirrored.
    let res = sqlx::query("DELETE FROM series WHERE id = $1")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    tx.commit().await?;
    Ok(())
}

pub async fn delete_character(
    pool: &PgPool,
    id: Uuid,
    replacement: Option<Uuid>,
) -> AppResult<()> {
    if Some(id) == replacement {
        return Err(AppError::BadRequest(
            "replacement character must differ from the one being deleted",
        ));
    }
    let mut tx = pool.begin().await?;
    if let Some(target) = replacement {
        let target_exists: (bool,) =
            sqlx::query_as("SELECT EXISTS(SELECT 1 FROM characters WHERE id = $1)")
                .bind(target)
                .fetch_one(&mut *tx)
                .await?;
        if !target_exists.0 {
            return Err(AppError::NotFound);
        }
        sqlx::query(
            "INSERT INTO figure_characters (figure_id, character_id)
             SELECT figure_id, $2 FROM figure_characters WHERE character_id = $1
             ON CONFLICT (figure_id, character_id) DO NOTHING",
        )
        .bind(id)
        .bind(target)
        .execute(&mut *tx)
        .await?;
    }
    let res = sqlx::query("DELETE FROM characters WHERE id = $1")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    tx.commit().await?;
    Ok(())
}

// =============================================================================
// Helpers
// =============================================================================

/// Resolve an entity image: when a Garage upload exists, point the SPA at
/// `/api/entity-image/{kind}/{id}` (proxied through the server using the
/// existing `Storage` abstraction). Otherwise return the external URL
/// stored alongside it. `None` when neither is set.
fn resolve_image(
    kind_path: &str,
    id: Uuid,
    image_key: &Option<String>,
    fallback_url: Option<&str>,
) -> Option<String> {
    if let Some(key) = image_key.as_deref() {
        if !key.is_empty() {
            return Some(format!("/api/entity-image/{kind_path}/{id}"));
        }
    }
    fallback_url.map(|s| s.to_string())
}

//! Figure catalog repository.

use crate::error::{AppError, AppResult};
use chrono::{DateTime, NaiveDate, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, PgPool, Row};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct Figure {
    pub id: Uuid,
    pub name: String,
    pub slug: String,
    pub manufacturer_id: Option<Uuid>,
    pub sculptor_id: Option<Uuid>,
    pub figure_type: String,
    pub scale: Option<String>,
    pub height_mm: Option<i32>,
    pub materials: Vec<String>,
    pub release_date: Option<NaiveDate>,
    pub msrp_amount: Option<Decimal>,
    pub msrp_currency: Option<String>,
    pub jan: Option<String>,
    pub exclusivity: Option<String>,
    pub edition: Option<String>,
    pub version_name: Option<String>,
    pub official_image_url: Option<String>,
    pub description: Option<String>,
    pub mfc_id: Option<i32>,
    pub created_by: Option<Uuid>,
    pub is_user_submitted: bool,
    pub is_nsfw: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    /// Resolved catalog cover photo id — only populated by `list()` (which
    /// joins on `figure_photos`). `find_by_id()` and `create()` leave it
    /// None; the SPA falls back to fetching `/api/figures/{id}/photos`
    /// directly for the detail page.
    #[sqlx(default)]
    pub primary_photo_id: Option<Uuid>,

    // ─── related-entity name + slug projection ───────────────────────────
    // These are joined by `find_by_id()` / `list()` so the SPA can render
    // "Manufacturer: GSC", "Series: Hatsune Miku" etc. without a follow-up
    // fetch. The matching `*_slug` fields let it link straight to the
    // dedicated entity page (`/manufacturers/:slug` etc.). `#[sqlx(default)]`
    // keeps the struct compatible with the narrower projections used
    // elsewhere (slug lookups, admin counts) — those simply leave these as
    // `None`.
    #[sqlx(default)]
    pub manufacturer_name: Option<String>,
    #[sqlx(default)]
    pub manufacturer_slug: Option<String>,
    #[sqlx(default)]
    pub sculptor_name: Option<String>,
    #[sqlx(default)]
    pub sculptor_slug: Option<String>,
    /// First series associated with the figure (figures can have several;
    /// we surface the oldest insertion). `None` when no series is linked.
    #[sqlx(default)]
    pub series_name: Option<String>,
    #[sqlx(default)]
    pub series_slug: Option<String>,
    /// First character associated with the figure. Same selection rule as
    /// `series_name`.
    #[sqlx(default)]
    pub character_name: Option<String>,
    #[sqlx(default)]
    pub character_slug: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct NewFigure {
    pub name: String,
    pub manufacturer_name: Option<String>,
    pub sculptor_name: Option<String>,
    #[serde(default = "default_type")]
    pub figure_type: String,
    pub scale: Option<String>,
    pub height_mm: Option<i32>,
    #[serde(default)]
    pub materials: Vec<String>,
    pub release_date: Option<NaiveDate>,
    pub msrp_amount: Option<Decimal>,
    pub msrp_currency: Option<String>,
    pub jan: Option<String>,
    pub exclusivity: Option<String>,
    pub edition: Option<String>,
    pub version_name: Option<String>,
    pub official_image_url: Option<String>,
    pub description: Option<String>,
    pub series_name: Option<String>,
    pub character_name: Option<String>,
    #[serde(default)]
    pub is_nsfw: bool,

    /// Optional URL the figure was imported from (orzgk product link, …).
    /// Not persisted on the figures table; the create flow only uses it to
    /// auto-link the new figure to any store whose `url` shares the same
    /// hostname. Lets users paste a store URL and have the M2M link drop
    /// into place in one round-trip.
    pub source_url: Option<String>,

    // ─── related-entity metadata (auto-fill from AniList / MAL / orzgk) ──
    // These are nested optional payloads carried alongside the *_name
    // strings. The upsert helpers persist them with COALESCE so admin edits
    // stay sticky: an enrichment never overwrites a non-NULL column.
    #[serde(default)]
    pub manufacturer_meta: ManufacturerMeta,
    #[serde(default)]
    pub series_meta: SeriesMeta,
    #[serde(default)]
    pub character_meta: CharacterMeta,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct ManufacturerMeta {
    pub description: Option<String>,
    pub logo_url: Option<String>,
    pub website_url: Option<String>,
    pub country: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct SeriesMeta {
    pub anilist_id: Option<i32>,
    pub mal_id: Option<i32>,
    pub description: Option<String>,
    pub cover_url: Option<String>,
    pub external_url: Option<String>,
    /// One of `anime` / `manga` / `game` / `vn` / `light_novel` / `original`
    /// / `other`. Falls back to the table default when omitted.
    pub origin: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct CharacterMeta {
    pub anilist_id: Option<i32>,
    pub mal_id: Option<i32>,
    pub description: Option<String>,
    pub portrait_url: Option<String>,
    pub external_url: Option<String>,
}

fn default_type() -> String {
    "other".to_string()
}

// Note: the valid figure_type slugs used to live in `ALLOWED_TYPES` here.
// They moved into the `figure_types` table (migration 21) so the admin can
// curate the list at runtime. See `domain::figure_type::exists`.

const ALLOWED_CURRENCIES_LEN: usize = 3;

const FIGURE_COLUMNS: &str = "id, name, slug, manufacturer_id, sculptor_id, figure_type, scale, \
     height_mm, materials, release_date, msrp_amount, msrp_currency, jan, exclusivity, edition, \
     version_name, official_image_url, description, mfc_id, created_by, is_user_submitted, \
     is_nsfw, created_at, updated_at";

/// Same columns as `FIGURE_COLUMNS` but each prefixed with the `f.` table
/// alias, for use in joined SELECTs.
const FIGURE_COLUMNS_PREFIXED: &str =
    "f.id, f.name, f.slug, f.manufacturer_id, f.sculptor_id, f.figure_type, f.scale, \
     f.height_mm, f.materials, f.release_date, f.msrp_amount, f.msrp_currency, f.jan, \
     f.exclusivity, f.edition, f.version_name, f.official_image_url, f.description, f.mfc_id, \
     f.created_by, f.is_user_submitted, f.is_nsfw, f.created_at, f.updated_at";

/// LEFT JOINs that pull the human-readable manufacturer / sculptor / series /
/// character names alongside the figure row.
///
/// `series` / `characters` are M2M; we project the first row per figure (by
/// FK id, which sort by upsert order) — matches the create / patch flow that
/// only supports a single value of each.
const FIGURE_NAME_JOINS: &str = "
    LEFT JOIN manufacturers m  ON m.id  = f.manufacturer_id
    LEFT JOIN sculptors     sc ON sc.id = f.sculptor_id
    LEFT JOIN LATERAL (
        SELECT s.name, s.slug FROM figure_series fs
        JOIN series s ON s.id = fs.series_id
        WHERE fs.figure_id = f.id
        ORDER BY fs.series_id LIMIT 1
    ) s ON TRUE
    LEFT JOIN LATERAL (
        SELECT ch.name, ch.slug FROM figure_characters fc
        JOIN characters ch ON ch.id = fc.character_id
        WHERE fc.figure_id = f.id
        ORDER BY fc.character_id LIMIT 1
    ) c ON TRUE";

/// Column projection corresponding to [`FIGURE_NAME_JOINS`]. Pair the two
/// or the row deserialises with `manufacturer_name` etc. left as `None`.
const FIGURE_NAME_PROJECTION: &str =
    ", m.name  AS manufacturer_name, m.slug  AS manufacturer_slug, \
       sc.name AS sculptor_name,     sc.slug AS sculptor_slug, \
       s.name  AS series_name,       s.slug  AS series_slug, \
       c.name  AS character_name,    c.slug  AS character_slug";

pub async fn create(pool: &PgPool, created_by: Uuid, input: NewFigure) -> AppResult<Figure> {
    // figure_type validation lives in the `figure_types` table now — admins
    // can add new types without a code change.
    if !super::figure_type::exists(pool, &input.figure_type).await? {
        return Err(AppError::BadRequest("invalid figure_type"));
    }
    if let Some(c) = &input.msrp_currency {
        if c.len() != ALLOWED_CURRENCIES_LEN {
            return Err(AppError::BadRequest("msrp_currency must be ISO 4217 (3 chars)"));
        }
    }
    if input.name.trim().is_empty() {
        return Err(AppError::BadRequest("name is required"));
    }
    if input.name.len() > 256 {
        return Err(AppError::BadRequest("name too long (max 256)"));
    }

    let mut tx = pool.begin().await?;

    // Optional FK lookups: create-or-find for manufacturer / sculptor / series / character.
    // Each upsert receives the matching meta payload so external-lookup
    // enrichments (AniList, MAL, orzgk) get persisted on first sight without
    // ever overwriting an admin-edited value.
    let manufacturer_id = match input.manufacturer_name.as_deref().map(str::trim) {
        Some(n) if !n.is_empty() => {
            Some(upsert_manufacturer(&mut tx, n, &input.manufacturer_meta).await?)
        }
        _ => None,
    };
    let sculptor_id = match input.sculptor_name.as_deref().map(str::trim) {
        Some(n) if !n.is_empty() => Some(upsert_sculptor(&mut tx, n).await?),
        _ => None,
    };
    let series_id = match input.series_name.as_deref().map(str::trim) {
        Some(n) if !n.is_empty() => Some(upsert_series(&mut tx, n, &input.series_meta).await?),
        _ => None,
    };
    let character_id = match (input.character_name.as_deref().map(str::trim), series_id) {
        (Some(n), sid) if !n.is_empty() => {
            Some(upsert_character(&mut tx, n, sid, &input.character_meta).await?)
        }
        _ => None,
    };

    let id = Uuid::now_v7();
    let slug = make_unique_slug(&mut tx, &input.name).await?;

    let insert_sql = format!(
        "INSERT INTO figures (
            id, name, slug, manufacturer_id, sculptor_id, figure_type, scale, height_mm,
            materials, release_date, msrp_amount, msrp_currency, jan, exclusivity, edition,
            version_name, official_image_url, description, created_by, is_user_submitted,
            is_nsfw
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,TRUE,$20)
         RETURNING {FIGURE_COLUMNS}"
    );

    let figure: Figure = sqlx::query_as(&insert_sql)
        .bind(id)
        .bind(&input.name)
        .bind(&slug)
        .bind(manufacturer_id)
        .bind(sculptor_id)
        .bind(&input.figure_type)
        .bind(&input.scale)
        .bind(input.height_mm)
        .bind(&input.materials)
        .bind(input.release_date)
        .bind(input.msrp_amount)
        .bind(&input.msrp_currency)
        .bind(&input.jan)
        .bind(&input.exclusivity)
        .bind(&input.edition)
        .bind(&input.version_name)
        .bind(&input.official_image_url)
        .bind(&input.description)
        .bind(created_by)
        .bind(input.is_nsfw)
        .fetch_one(&mut *tx)
        .await
        .map_err(map_unique_violation)?;

    if let Some(sid) = series_id {
        sqlx::query("INSERT INTO figure_series (figure_id, series_id) VALUES ($1, $2) ON CONFLICT DO NOTHING")
            .bind(figure.id)
            .bind(sid)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(cid) = character_id {
        sqlx::query("INSERT INTO figure_characters (figure_id, character_id) VALUES ($1, $2) ON CONFLICT DO NOTHING")
            .bind(figure.id)
            .bind(cid)
            .execute(&mut *tx)
            .await?;
    }

    // Auto-link to any store whose `url` matches the source URL's hostname.
    // Hostname comparison (case-insensitive, sans leading `www.`) is more
    // forgiving than literal prefix matching — http vs https, trailing
    // slashes, and product subpaths all still match the right store.
    if let Some(host) = input.source_url.as_deref().and_then(extract_host) {
        sqlx::query(
            "INSERT INTO figure_stores (figure_id, store_id)
             SELECT $1, s.id FROM stores s
             WHERE s.url IS NOT NULL
               AND regexp_replace(lower(split_part(split_part(s.url, '://', 2), '/', 1)), '^www\\.', '') = $2
             ON CONFLICT DO NOTHING",
        )
        .bind(figure.id)
        .bind(&host)
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;
    // Re-fetch via find_by_id so the response carries the joined
    // manufacturer / sculptor / series / character names (the INSERT itself
    // returns only the bare figure columns).
    Ok(find_by_id(pool, figure.id)
        .await?
        .expect("figure just inserted should exist"))
}

#[derive(Debug, Default, Deserialize)]
pub struct ListQuery {
    pub q: Option<String>,
    pub figure_type: Option<String>,
    pub manufacturer: Option<String>,
    #[serde(default)]
    pub limit: Option<i64>,
    #[serde(default)]
    pub offset: Option<i64>,
    /// When `true`, NSFW figures are excluded from the result. Routes pass
    /// this based on the viewer's `nsfw_visibility` preference.
    #[serde(default, skip_deserializing)]
    pub exclude_nsfw: bool,
}

pub async fn list(pool: &PgPool, q: ListQuery) -> AppResult<Vec<Figure>> {
    let limit = q.limit.unwrap_or(50).clamp(1, 200);
    let offset = q.offset.unwrap_or(0).max(0);

    // Listing projection adds a correlated subquery for the catalog primary
    // photo so the SPA can render thumbnails without a follow-up fetch per
    // row. `is_primary DESC` puts the primary first when one exists, then
    // falls back to position order. The name projection + joins mirror
    // `find_by_id()` so list rows carry the same enriched fields the detail
    // page expects.
    let mut sql = format!(
        "SELECT {FIGURE_COLUMNS_PREFIXED}{FIGURE_NAME_PROJECTION},
                (SELECT fp.id FROM figure_photos fp
                 WHERE fp.figure_id = f.id
                 ORDER BY fp.is_primary DESC, fp.position ASC, fp.created_at ASC
                 LIMIT 1) AS primary_photo_id
         FROM figures f {FIGURE_NAME_JOINS}
         WHERE TRUE"
    );
    if q.exclude_nsfw {
        sql.push_str(" AND NOT f.is_nsfw");
    }
    let mut binds: Vec<String> = Vec::new();

    if q.q.is_some() {
        binds.push("name_ilike".into());
        sql.push_str(&format!(" AND f.name ILIKE ${} ", binds.len()));
    }
    if q.figure_type.is_some() {
        binds.push("type".into());
        sql.push_str(&format!(" AND f.figure_type = ${} ", binds.len()));
    }
    if q.manufacturer.is_some() {
        binds.push("manufacturer".into());
        sql.push_str(&format!(
            " AND f.manufacturer_id IN (SELECT id FROM manufacturers WHERE slug = ${} OR LOWER(name) = LOWER(${})) ",
            binds.len(),
            binds.len()
        ));
    }
    sql.push_str(" ORDER BY f.created_at DESC LIMIT ");
    binds.push("limit".into());
    sql.push_str(&format!("${} OFFSET ", binds.len()));
    binds.push("offset".into());
    sql.push_str(&format!("${}", binds.len()));

    let mut query = sqlx::query_as::<_, Figure>(&sql);
    for tag in &binds {
        query = match tag.as_str() {
            "name_ilike" => query.bind(format!("%{}%", q.q.as_deref().unwrap())),
            "type" => query.bind(q.figure_type.clone().unwrap()),
            "manufacturer" => query.bind(q.manufacturer.clone().unwrap()),
            "limit" => query.bind(limit),
            "offset" => query.bind(offset),
            _ => query,
        };
    }
    Ok(query.fetch_all(pool).await?)
}

pub async fn find_by_id(pool: &PgPool, id: Uuid) -> AppResult<Option<Figure>> {
    let sql = format!(
        "SELECT {FIGURE_COLUMNS_PREFIXED}{FIGURE_NAME_PROJECTION} \
         FROM figures f {FIGURE_NAME_JOINS} \
         WHERE f.id = $1"
    );
    Ok(sqlx::query_as::<_, Figure>(&sql)
        .bind(id)
        .fetch_optional(pool)
        .await?)
}

/// Partial update on the catalog row. Used by `PATCH /api/figures/{id}`,
/// gated by the route to admins + the figure's creator.
#[derive(Debug, Clone, Deserialize, Default)]
pub struct FigurePatch {
    pub name: Option<String>,
    pub manufacturer_name: Option<String>,
    pub sculptor_name: Option<String>,
    pub figure_type: Option<String>,
    pub scale: Option<String>,
    pub height_mm: Option<i32>,
    pub materials: Option<Vec<String>>,
    pub release_date: Option<NaiveDate>,
    pub msrp_amount: Option<Decimal>,
    pub msrp_currency: Option<String>,
    pub jan: Option<String>,
    pub exclusivity: Option<String>,
    pub edition: Option<String>,
    pub version_name: Option<String>,
    pub official_image_url: Option<String>,
    pub description: Option<String>,
    pub series_name: Option<String>,
    pub character_name: Option<String>,
    pub is_nsfw: Option<bool>,
    #[serde(default)]
    pub manufacturer_meta: ManufacturerMeta,
    #[serde(default)]
    pub series_meta: SeriesMeta,
    #[serde(default)]
    pub character_meta: CharacterMeta,
}

pub async fn patch(pool: &PgPool, id: Uuid, input: FigurePatch) -> AppResult<Figure> {
    if let Some(ft) = &input.figure_type {
        if !super::figure_type::exists(pool, ft).await? {
            return Err(AppError::BadRequest("invalid figure_type"));
        }
    }
    if let Some(c) = &input.msrp_currency {
        if c.len() != ALLOWED_CURRENCIES_LEN {
            return Err(AppError::BadRequest("msrp_currency must be ISO 4217 (3 chars)"));
        }
    }
    if let Some(n) = &input.name {
        if n.trim().is_empty() {
            return Err(AppError::BadRequest("name cannot be blank"));
        }
        if n.len() > 256 {
            return Err(AppError::BadRequest("name too long (max 256)"));
        }
    }

    let mut tx = pool.begin().await?;

    // Resolve optional FK lookups, same upsert paths as create() — meta gets
    // carried through so AniList / MAL / orzgk enrichment lands in the
    // related rows even on a patch.
    let manufacturer_id = match input.manufacturer_name.as_deref().map(str::trim) {
        Some(n) if !n.is_empty() => {
            Some(upsert_manufacturer(&mut tx, n, &input.manufacturer_meta).await?)
        }
        _ => None,
    };
    let sculptor_id = match input.sculptor_name.as_deref().map(str::trim) {
        Some(n) if !n.is_empty() => Some(upsert_sculptor(&mut tx, n).await?),
        _ => None,
    };

    let update_sql = format!(
        "UPDATE figures SET
            name               = COALESCE($1, name),
            manufacturer_id    = COALESCE($2, manufacturer_id),
            sculptor_id        = COALESCE($3, sculptor_id),
            figure_type        = COALESCE($4, figure_type),
            scale              = COALESCE($5, scale),
            height_mm          = COALESCE($6, height_mm),
            materials          = COALESCE($7, materials),
            release_date       = COALESCE($8, release_date),
            msrp_amount        = COALESCE($9, msrp_amount),
            msrp_currency      = COALESCE($10, msrp_currency),
            jan                = COALESCE($11, jan),
            exclusivity        = COALESCE($12, exclusivity),
            edition            = COALESCE($13, edition),
            version_name       = COALESCE($14, version_name),
            official_image_url = COALESCE($15, official_image_url),
            description        = COALESCE($16, description),
            is_nsfw            = COALESCE($17, is_nsfw)
         WHERE id = $18
         RETURNING {FIGURE_COLUMNS}"
    );

    let updated: Option<Figure> = sqlx::query_as(&update_sql)
        .bind(&input.name)
        .bind(manufacturer_id)
        .bind(sculptor_id)
        .bind(&input.figure_type)
        .bind(&input.scale)
        .bind(input.height_mm)
        .bind(&input.materials)
        .bind(input.release_date)
        .bind(input.msrp_amount)
        .bind(&input.msrp_currency)
        .bind(&input.jan)
        .bind(&input.exclusivity)
        .bind(&input.edition)
        .bind(&input.version_name)
        .bind(&input.official_image_url)
        .bind(&input.description)
        .bind(input.is_nsfw)
        .bind(id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(map_unique_violation)?;

    let figure = updated.ok_or(AppError::NotFound)?;

    // Series / character associations — if the patch passed a value, sync.
    // We don't try to remove old links here; that's a v2 concern.
    let series_id = match input.series_name.as_deref().map(str::trim) {
        Some(n) if !n.is_empty() => Some(upsert_series(&mut tx, n, &input.series_meta).await?),
        _ => None,
    };
    if let Some(sid) = series_id {
        sqlx::query(
            "INSERT INTO figure_series (figure_id, series_id) VALUES ($1, $2) \
             ON CONFLICT DO NOTHING",
        )
        .bind(figure.id)
        .bind(sid)
        .execute(&mut *tx)
        .await?;
    }
    let character_id = match (input.character_name.as_deref().map(str::trim), series_id) {
        (Some(n), sid) if !n.is_empty() => {
            Some(upsert_character(&mut tx, n, sid, &input.character_meta).await?)
        }
        _ => None,
    };
    if let Some(cid) = character_id {
        sqlx::query(
            "INSERT INTO figure_characters (figure_id, character_id) VALUES ($1, $2) \
             ON CONFLICT DO NOTHING",
        )
        .bind(figure.id)
        .bind(cid)
        .execute(&mut *tx)
        .await?;
    }

    let figure_id = figure.id;
    tx.commit().await?;
    // Same re-fetch as `create()` so the PATCH response includes the joined
    // names (figure_series / figure_characters get inserted *after* the
    // UPDATE's RETURNING clause runs).
    Ok(find_by_id(pool, figure_id)
        .await?
        .expect("figure just updated should exist"))
}

/// Hard-delete a figure. Cascading is handled by the schema:
/// owned_items.figure_id has `ON DELETE CASCADE`, so this also removes any
/// user's instance of the figure. Admin endpoints must double-check that
/// the caller really wants this.
pub async fn delete(pool: &PgPool, id: Uuid) -> AppResult<()> {
    let result = sqlx::query("DELETE FROM figures WHERE id = $1")
        .bind(id)
        .execute(pool)
        .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    Ok(())
}

// ----- Helpers ---------------------------------------------------------------

async fn upsert_manufacturer(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    name: &str,
    meta: &ManufacturerMeta,
) -> AppResult<Uuid> {
    let slug = slugify(name);
    // Each metadata column is filled only when currently NULL — admin edits
    // win over auto-enrichment forever.
    let row = sqlx::query(
        "INSERT INTO manufacturers
            (name, slug, description, logo_url, website_url, country)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (slug) DO UPDATE SET
            description = COALESCE(manufacturers.description, EXCLUDED.description),
            logo_url    = COALESCE(manufacturers.logo_url,    EXCLUDED.logo_url),
            website_url = COALESCE(manufacturers.website_url, EXCLUDED.website_url),
            country     = COALESCE(manufacturers.country,     EXCLUDED.country)
         RETURNING id",
    )
    .bind(name)
    .bind(&slug)
    .bind(&meta.description)
    .bind(&meta.logo_url)
    .bind(&meta.website_url)
    .bind(&meta.country)
    .fetch_one(&mut **tx)
    .await?;
    Ok(row.get(0))
}

async fn upsert_sculptor(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    name: &str,
) -> AppResult<Uuid> {
    let slug = slugify(name);
    let row = sqlx::query(
        "INSERT INTO sculptors (name, slug) VALUES ($1, $2) \
         ON CONFLICT (slug) DO UPDATE SET name = sculptors.name \
         RETURNING id",
    )
    .bind(name)
    .bind(&slug)
    .fetch_one(&mut **tx)
    .await?;
    Ok(row.get(0))
}

async fn upsert_series(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    name: &str,
    meta: &SeriesMeta,
) -> AppResult<Uuid> {
    // Prefer matching on AniList / MAL id when present: same upstream entity
    // → same row, even if the name + slug have drifted slightly.
    if let Some(aid) = meta.anilist_id {
        if let Some((id,)) =
            sqlx::query_as::<_, (Uuid,)>("SELECT id FROM series WHERE anilist_id = $1")
                .bind(aid)
                .fetch_optional(&mut **tx)
                .await?
        {
            apply_series_meta(tx, id, name, meta).await?;
            return Ok(id);
        }
    }
    if let Some(mid) = meta.mal_id {
        if let Some((id,)) =
            sqlx::query_as::<_, (Uuid,)>("SELECT id FROM series WHERE mal_id = $1")
                .bind(mid)
                .fetch_optional(&mut **tx)
                .await?
        {
            apply_series_meta(tx, id, name, meta).await?;
            return Ok(id);
        }
    }

    // Name-based fallback: the slug-only ON CONFLICT below catches duplicates
    // when slugify produces the same string, but non-ASCII characters get
    // stripped (e.g. "Pokémon" → "pokmon" but "Pokemon" → "pokemon", two
    // distinct slugs for the *same* series). Case-insensitive trim match
    // closes that hole: if the user typed a name that already exists in any
    // common casing/whitespace variant, reuse the row.
    if let Some((id,)) = sqlx::query_as::<_, (Uuid,)>(
        "SELECT id FROM series WHERE LOWER(TRIM(name)) = LOWER(TRIM($1)) LIMIT 1",
    )
    .bind(name)
    .fetch_optional(&mut **tx)
    .await?
    {
        apply_series_meta(tx, id, name, meta).await?;
        return Ok(id);
    }

    let slug = slugify(name);
    let row = sqlx::query(
        "INSERT INTO series
            (name, slug, origin, anilist_id, mal_id, description, cover_url, external_url)
         VALUES ($1, $2, COALESCE($3, 'other'), $4, $5, $6, $7, $8)
         ON CONFLICT (slug) DO UPDATE SET
            origin       = CASE WHEN series.origin = 'other' THEN COALESCE(EXCLUDED.origin, series.origin) ELSE series.origin END,
            anilist_id   = COALESCE(series.anilist_id,   EXCLUDED.anilist_id),
            mal_id       = COALESCE(series.mal_id,       EXCLUDED.mal_id),
            description  = COALESCE(series.description,  EXCLUDED.description),
            cover_url    = COALESCE(series.cover_url,    EXCLUDED.cover_url),
            external_url = COALESCE(series.external_url, EXCLUDED.external_url)
         RETURNING id",
    )
    .bind(name)
    .bind(&slug)
    .bind(&meta.origin)
    .bind(meta.anilist_id)
    .bind(meta.mal_id)
    .bind(&meta.description)
    .bind(&meta.cover_url)
    .bind(&meta.external_url)
    .fetch_one(&mut **tx)
    .await?;
    Ok(row.get(0))
}

/// Apply `meta` to an existing series row, never overwriting non-NULL values.
async fn apply_series_meta(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    id: Uuid,
    _name: &str,
    meta: &SeriesMeta,
) -> AppResult<()> {
    sqlx::query(
        "UPDATE series SET
            origin       = CASE WHEN origin = 'other' THEN COALESCE($2, origin) ELSE origin END,
            anilist_id   = COALESCE(anilist_id,   $3),
            mal_id       = COALESCE(mal_id,       $4),
            description  = COALESCE(description,  $5),
            cover_url    = COALESCE(cover_url,    $6),
            external_url = COALESCE(external_url, $7)
         WHERE id = $1",
    )
    .bind(id)
    .bind(&meta.origin)
    .bind(meta.anilist_id)
    .bind(meta.mal_id)
    .bind(&meta.description)
    .bind(&meta.cover_url)
    .bind(&meta.external_url)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

async fn upsert_character(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    name: &str,
    series_id: Option<Uuid>,
    meta: &CharacterMeta,
) -> AppResult<Uuid> {
    // AniList / MAL id takes precedence over slug — same character across
    // series associations shouldn't get duplicated.
    if let Some(aid) = meta.anilist_id {
        if let Some((id,)) =
            sqlx::query_as::<_, (Uuid,)>("SELECT id FROM characters WHERE anilist_id = $1")
                .bind(aid)
                .fetch_optional(&mut **tx)
                .await?
        {
            apply_character_meta(tx, id, series_id, meta).await?;
            return Ok(id);
        }
    }
    if let Some(mid) = meta.mal_id {
        if let Some((id,)) =
            sqlx::query_as::<_, (Uuid,)>("SELECT id FROM characters WHERE mal_id = $1")
                .bind(mid)
                .fetch_optional(&mut **tx)
                .await?
        {
            apply_character_meta(tx, id, series_id, meta).await?;
            return Ok(id);
        }
    }

    // Name-based fallback (same reason as upsert_series). Scope the match to
    // the same series_id when one is provided — two characters of the same
    // name across different shows are genuinely distinct, so we only collapse
    // within a series. NULL-safe comparison via IS NOT DISTINCT FROM.
    if let Some((id,)) = sqlx::query_as::<_, (Uuid,)>(
        "SELECT id FROM characters
         WHERE LOWER(TRIM(name)) = LOWER(TRIM($1))
           AND series_id IS NOT DISTINCT FROM $2
         LIMIT 1",
    )
    .bind(name)
    .bind(series_id)
    .fetch_optional(&mut **tx)
    .await?
    {
        apply_character_meta(tx, id, series_id, meta).await?;
        return Ok(id);
    }

    let slug = match series_id {
        Some(sid) => format!("{}--{}", slugify(name), &sid.to_string()[..8]),
        None => slugify(name),
    };
    let row = sqlx::query(
        "INSERT INTO characters
            (name, slug, series_id, anilist_id, mal_id, description, portrait_url, external_url)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (slug) DO UPDATE SET
            series_id    = COALESCE(characters.series_id,    EXCLUDED.series_id),
            anilist_id   = COALESCE(characters.anilist_id,   EXCLUDED.anilist_id),
            mal_id       = COALESCE(characters.mal_id,       EXCLUDED.mal_id),
            description  = COALESCE(characters.description,  EXCLUDED.description),
            portrait_url = COALESCE(characters.portrait_url, EXCLUDED.portrait_url),
            external_url = COALESCE(characters.external_url, EXCLUDED.external_url)
         RETURNING id",
    )
    .bind(name)
    .bind(&slug)
    .bind(series_id)
    .bind(meta.anilist_id)
    .bind(meta.mal_id)
    .bind(&meta.description)
    .bind(&meta.portrait_url)
    .bind(&meta.external_url)
    .fetch_one(&mut **tx)
    .await?;
    Ok(row.get(0))
}

async fn apply_character_meta(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    id: Uuid,
    series_id: Option<Uuid>,
    meta: &CharacterMeta,
) -> AppResult<()> {
    sqlx::query(
        "UPDATE characters SET
            series_id    = COALESCE(series_id,    $2),
            anilist_id   = COALESCE(anilist_id,   $3),
            mal_id       = COALESCE(mal_id,       $4),
            description  = COALESCE(description,  $5),
            portrait_url = COALESCE(portrait_url, $6),
            external_url = COALESCE(external_url, $7)
         WHERE id = $1",
    )
    .bind(id)
    .bind(series_id)
    .bind(meta.anilist_id)
    .bind(meta.mal_id)
    .bind(&meta.description)
    .bind(&meta.portrait_url)
    .bind(&meta.external_url)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

async fn make_unique_slug(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    name: &str,
) -> AppResult<String> {
    let base = slugify(name);
    let mut candidate = base.clone();
    let mut suffix: u16 = 0;
    loop {
        let existing: Option<(Uuid,)> =
            sqlx::query_as("SELECT id FROM figures WHERE slug = $1")
                .bind(&candidate)
                .fetch_optional(&mut **tx)
                .await?;
        if existing.is_none() {
            return Ok(candidate);
        }
        suffix = suffix.saturating_add(1);
        candidate = format!("{base}-{:03}", suffix);
        if suffix > 999 {
            return Err(AppError::Conflict("could not generate a unique slug"));
        }
    }
}

fn slugify(s: &str) -> String {
    let mut prev_dash = false;
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c.to_ascii_lowercase());
            prev_dash = false;
        } else if !prev_dash && !out.is_empty() {
            out.push('-');
            prev_dash = true;
        }
    }
    if out.ends_with('-') {
        out.pop();
    }
    if out.is_empty() {
        out.push_str("untitled");
    }
    out.chars().take(80).collect()
}

fn map_unique_violation(e: sqlx::Error) -> AppError {
    match &e {
        sqlx::Error::Database(db) if db.is_unique_violation() => {
            AppError::Conflict("figure with that identifier already exists")
        }
        _ => AppError::Db(e),
    }
}

/// Extract the lowercase hostname (sans leading `www.`) from a URL string.
/// Returns None for malformed input — quietly skipping the auto-link path
/// is the right behaviour: a bad source URL simply means no store gets
/// linked, never a server-side failure on figure creation.
fn extract_host(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    // Tolerate the user pasting a URL without a scheme (orzgk.com/...).
    let url = if trimmed.contains("://") {
        url::Url::parse(trimmed).ok()?
    } else {
        url::Url::parse(&format!("https://{}", trimmed)).ok()?
    };
    let host = url.host_str()?.to_lowercase();
    Some(host.trim_start_matches("www.").to_string())
}

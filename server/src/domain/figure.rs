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
}

fn default_type() -> String {
    "other".to_string()
}

const ALLOWED_TYPES: &[&str] = &[
    "scale",
    "nendoroid",
    "figma",
    "prize",
    "trading",
    "statue",
    "plamo",
    "bishoujo",
    "dakimakura",
    "other",
];

const ALLOWED_CURRENCIES_LEN: usize = 3;

const FIGURE_COLUMNS: &str = "id, name, slug, manufacturer_id, sculptor_id, figure_type, scale, \
     height_mm, materials, release_date, msrp_amount, msrp_currency, jan, exclusivity, edition, \
     version_name, official_image_url, description, mfc_id, created_by, is_user_submitted, \
     is_nsfw, created_at, updated_at";

pub async fn create(pool: &PgPool, created_by: Uuid, input: NewFigure) -> AppResult<Figure> {
    if !ALLOWED_TYPES.contains(&input.figure_type.as_str()) {
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
    let manufacturer_id = match input.manufacturer_name.as_deref().map(str::trim) {
        Some(n) if !n.is_empty() => Some(upsert_manufacturer(&mut tx, n).await?),
        _ => None,
    };
    let sculptor_id = match input.sculptor_name.as_deref().map(str::trim) {
        Some(n) if !n.is_empty() => Some(upsert_sculptor(&mut tx, n).await?),
        _ => None,
    };
    let series_id = match input.series_name.as_deref().map(str::trim) {
        Some(n) if !n.is_empty() => Some(upsert_series(&mut tx, n).await?),
        _ => None,
    };
    let character_id = match (input.character_name.as_deref().map(str::trim), series_id) {
        (Some(n), sid) if !n.is_empty() => Some(upsert_character(&mut tx, n, sid).await?),
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

    tx.commit().await?;
    Ok(figure)
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
    // falls back to position order.
    let mut sql = format!(
        "SELECT {FIGURE_COLUMNS},
                (SELECT fp.id FROM figure_photos fp
                 WHERE fp.figure_id = figures.id
                 ORDER BY fp.is_primary DESC, fp.position ASC, fp.created_at ASC
                 LIMIT 1) AS primary_photo_id
         FROM figures WHERE TRUE"
    );
    if q.exclude_nsfw {
        sql.push_str(" AND NOT is_nsfw");
    }
    let mut binds: Vec<String> = Vec::new();

    if q.q.is_some() {
        binds.push("name_ilike".into());
        sql.push_str(&format!(" AND name ILIKE ${} ", binds.len()));
    }
    if q.figure_type.is_some() {
        binds.push("type".into());
        sql.push_str(&format!(" AND figure_type = ${} ", binds.len()));
    }
    if q.manufacturer.is_some() {
        binds.push("manufacturer".into());
        sql.push_str(&format!(
            " AND manufacturer_id IN (SELECT id FROM manufacturers WHERE slug = ${} OR LOWER(name) = LOWER(${})) ",
            binds.len(),
            binds.len()
        ));
    }
    sql.push_str(" ORDER BY created_at DESC LIMIT ");
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
    let sql = format!("SELECT {FIGURE_COLUMNS} FROM figures WHERE id = $1");
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
}

pub async fn patch(pool: &PgPool, id: Uuid, input: FigurePatch) -> AppResult<Figure> {
    if let Some(ft) = &input.figure_type {
        if !ALLOWED_TYPES.contains(&ft.as_str()) {
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

    // Resolve optional FK lookups, same upsert paths as create().
    let manufacturer_id = match input.manufacturer_name.as_deref().map(str::trim) {
        Some(n) if !n.is_empty() => Some(upsert_manufacturer(&mut tx, n).await?),
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
        Some(n) if !n.is_empty() => Some(upsert_series(&mut tx, n).await?),
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
        (Some(n), sid) if !n.is_empty() => Some(upsert_character(&mut tx, n, sid).await?),
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

    tx.commit().await?;
    Ok(figure)
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
) -> AppResult<Uuid> {
    let slug = slugify(name);
    let row = sqlx::query(
        "INSERT INTO manufacturers (name, slug) VALUES ($1, $2) \
         ON CONFLICT (slug) DO UPDATE SET name = manufacturers.name \
         RETURNING id",
    )
    .bind(name)
    .bind(&slug)
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
) -> AppResult<Uuid> {
    let slug = slugify(name);
    let row = sqlx::query(
        "INSERT INTO series (name, slug) VALUES ($1, $2) \
         ON CONFLICT (slug) DO UPDATE SET name = series.name \
         RETURNING id",
    )
    .bind(name)
    .bind(&slug)
    .fetch_one(&mut **tx)
    .await?;
    Ok(row.get(0))
}

async fn upsert_character(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    name: &str,
    series_id: Option<Uuid>,
) -> AppResult<Uuid> {
    let slug = match series_id {
        Some(sid) => format!("{}--{}", slugify(name), &sid.to_string()[..8]),
        None => slugify(name),
    };
    let row = sqlx::query(
        "INSERT INTO characters (name, slug, series_id) VALUES ($1, $2, $3) \
         ON CONFLICT (slug) DO UPDATE SET name = characters.name \
         RETURNING id",
    )
    .bind(name)
    .bind(&slug)
    .bind(series_id)
    .fetch_one(&mut **tx)
    .await?;
    Ok(row.get(0))
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

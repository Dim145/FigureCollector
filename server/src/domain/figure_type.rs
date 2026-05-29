//! Figure-type catalogue.
//!
//! The valid set of `figures.figure_type` values was historically a Rust
//! `const ALLOWED_TYPES: &[&str]` — moving it into a table (`figure_types`)
//! lets the admin add new categories (e.g. `bust`, `chibi`) without a code
//! change.
//!
//! Schema mirror:
//!   id          TEXT PK     — slug, what `figures.figure_type` stores
//!   label_fr    TEXT NOT NULL
//!   label_en    TEXT NOT NULL
//!   kanji       TEXT NOT NULL
//!   position    INTEGER     — drives dropdown order, lowest first
//!   created_at  TIMESTAMPTZ
//!   updated_at  TIMESTAMPTZ — bumped by trigger
//!
//! Deletes are blocked when any `figures` row still references the slug —
//! callers get a 409 Conflict back rather than a FK violation hiding the
//! real intent.

use crate::error::{AppError, AppResult};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, PgPool};

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct FigureType {
    pub id: String,
    pub label_fr: String,
    pub label_en: String,
    pub kanji: String,
    pub position: i32,
    /// Admin-set signature accent colour (CSS colour string). `None` → the SPA
    /// keeps its built-in per-theme `--type-<slug>` default.
    pub accent_color: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct NewFigureType {
    pub id: String,
    pub label_fr: String,
    pub label_en: String,
    pub kanji: String,
    #[serde(default = "default_position")]
    pub position: i32,
    #[serde(default)]
    pub accent_color: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct FigureTypePatch {
    pub label_fr: Option<String>,
    pub label_en: Option<String>,
    pub kanji: Option<String>,
    pub position: Option<i32>,
    // `Option<Option<String>>` via `double_option`: distinguishes the field
    // being ABSENT (None → keep) from explicit `null` (Some(None) → clear) from
    // a value (Some(Some(s)) → set). A plain `Option<String>` would map JSON
    // `null` to None, conflating "absent" and "clear".
    #[serde(default, deserialize_with = "double_option")]
    pub accent_color: Option<Option<String>>,
}

fn default_position() -> i32 {
    100
}

/// serde helper: a present field (even `null`) deserialises to `Some(...)`,
/// an absent field stays `None`.
fn double_option<'de, D, T>(de: D) -> Result<Option<Option<T>>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: serde::Deserialize<'de>,
{
    Ok(Some(Option::deserialize(de)?))
}

/// Validate + normalise an admin-supplied accent colour. Whitespace-only → the
/// colour is cleared (`None`). Admins are trusted, so this is hygiene, not a
/// security boundary: keep it to one short colour token and forbid the
/// characters that could break out of the `--type-*` custom property the SPA
/// injects it into.
fn normalize_color(raw: Option<String>) -> AppResult<Option<String>> {
    match raw.map(|s| s.trim().to_string()).filter(|s| !s.is_empty()) {
        None => Ok(None),
        Some(s)
            if s.len() <= 64
                && !s
                    .chars()
                    .any(|c| c.is_control() || matches!(c, ';' | '{' | '}' | '<' | '>')) =>
        {
            Ok(Some(s))
        }
        Some(_) => Err(AppError::BadRequest(
            "accent_color must be a single CSS colour (e.g. #c8a24b or oklch(0.7 0.13 80))",
        )),
    }
}

/// Public list — everyone needs it to populate the figure-type dropdown.
pub async fn list(pool: &PgPool) -> AppResult<Vec<FigureType>> {
    Ok(sqlx::query_as::<_, FigureType>(
        "SELECT id, label_fr, label_en, kanji, position, accent_color, created_at, updated_at
         FROM figure_types
         ORDER BY position ASC, id ASC",
    )
    .fetch_all(pool)
    .await?)
}

/// Returns true when at least one `figures` row uses this slug — used by
/// the admin UI to gate delete behind a confirmation when count > 0.
pub async fn usage_count(pool: &PgPool, id: &str) -> AppResult<i64> {
    let row: (i64,) =
        sqlx::query_as("SELECT COUNT(*)::bigint FROM figures WHERE figure_type = $1")
            .bind(id)
            .fetch_one(pool)
            .await?;
    Ok(row.0)
}

pub async fn create(pool: &PgPool, input: NewFigureType) -> AppResult<FigureType> {
    let id = input.id.trim();
    if id.is_empty() {
        return Err(AppError::BadRequest("id (slug) is required"));
    }
    if !id
        .chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_' || c == '-')
    {
        return Err(AppError::BadRequest(
            "id must be a slug: ascii-lowercase, digits, _ or -",
        ));
    }
    if input.label_fr.trim().is_empty() || input.label_en.trim().is_empty() {
        return Err(AppError::BadRequest("label_fr and label_en are required"));
    }
    if input.kanji.trim().is_empty() {
        return Err(AppError::BadRequest("kanji is required"));
    }
    let accent = normalize_color(input.accent_color)?;

    sqlx::query_as::<_, FigureType>(
        "INSERT INTO figure_types (id, label_fr, label_en, kanji, position, accent_color)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, label_fr, label_en, kanji, position, accent_color, created_at, updated_at",
    )
    .bind(id)
    .bind(input.label_fr.trim())
    .bind(input.label_en.trim())
    .bind(input.kanji.trim())
    .bind(input.position)
    .bind(accent)
    .fetch_one(pool)
    .await
    .map_err(|e| match e {
        sqlx::Error::Database(ref db) if db.is_unique_violation() => {
            AppError::BadRequest("a figure_type with that id already exists")
        }
        other => AppError::Db(other),
    })
}

pub async fn patch(pool: &PgPool, id: &str, input: FigureTypePatch) -> AppResult<FigureType> {
    // accent_color: present (Some) → set to value or NULL; absent (None) → keep.
    let (accent_set, accent_val): (bool, Option<String>) = match input.accent_color {
        None => (false, None),
        Some(v) => (true, normalize_color(v)?),
    };
    let row: Option<FigureType> = sqlx::query_as(
        "UPDATE figure_types SET
            label_fr     = COALESCE($1, label_fr),
            label_en     = COALESCE($2, label_en),
            kanji        = COALESCE($3, kanji),
            position     = COALESCE($4, position),
            accent_color = CASE WHEN $5 THEN $6::text ELSE accent_color END
         WHERE id = $7
         RETURNING id, label_fr, label_en, kanji, position, accent_color, created_at, updated_at",
    )
    .bind(input.label_fr.as_ref().map(|s| s.trim()))
    .bind(input.label_en.as_ref().map(|s| s.trim()))
    .bind(input.kanji.as_ref().map(|s| s.trim()))
    .bind(input.position)
    .bind(accent_set)
    .bind(accent_val)
    .bind(id)
    .fetch_optional(pool)
    .await?;
    row.ok_or(AppError::NotFound)
}

pub async fn delete(pool: &PgPool, id: &str) -> AppResult<()> {
    // Refuse the delete when figures still reference the slug. The admin
    // UI is expected to call `usage_count` first (exposed at
    // GET /admin/figure-types/{id}/usage) so the count can be shown in
    // the confirm prompt — here we only enforce the invariant.
    let used = usage_count(pool, id).await?;
    if used > 0 {
        return Err(AppError::Conflict("figure_type still referenced by figures"));
    }
    let res = sqlx::query("DELETE FROM figure_types WHERE id = $1")
        .bind(id)
        .execute(pool)
        .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    Ok(())
}

/// Async version of the old `ALLOWED_TYPES.contains(slug)` check. Called
/// by figure-creation/update paths so the constraint is sourced from the
/// table rather than a Rust const.
pub async fn exists(pool: &PgPool, id: &str) -> AppResult<bool> {
    let row: (bool,) =
        sqlx::query_as("SELECT EXISTS(SELECT 1 FROM figure_types WHERE id = $1)")
            .bind(id)
            .fetch_one(pool)
            .await?;
    Ok(row.0)
}

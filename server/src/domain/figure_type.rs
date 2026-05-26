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
}

#[derive(Debug, Clone, Deserialize)]
pub struct FigureTypePatch {
    pub label_fr: Option<String>,
    pub label_en: Option<String>,
    pub kanji: Option<String>,
    pub position: Option<i32>,
}

fn default_position() -> i32 {
    100
}

/// Public list — everyone needs it to populate the figure-type dropdown.
pub async fn list(pool: &PgPool) -> AppResult<Vec<FigureType>> {
    Ok(sqlx::query_as::<_, FigureType>(
        "SELECT id, label_fr, label_en, kanji, position, created_at, updated_at
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

    sqlx::query_as::<_, FigureType>(
        "INSERT INTO figure_types (id, label_fr, label_en, kanji, position)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, label_fr, label_en, kanji, position, created_at, updated_at",
    )
    .bind(id)
    .bind(input.label_fr.trim())
    .bind(input.label_en.trim())
    .bind(input.kanji.trim())
    .bind(input.position)
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
    let row: Option<FigureType> = sqlx::query_as(
        "UPDATE figure_types SET
            label_fr  = COALESCE($1, label_fr),
            label_en  = COALESCE($2, label_en),
            kanji     = COALESCE($3, kanji),
            position  = COALESCE($4, position)
         WHERE id = $5
         RETURNING id, label_fr, label_en, kanji, position, created_at, updated_at",
    )
    .bind(input.label_fr.as_ref().map(|s| s.trim()))
    .bind(input.label_en.as_ref().map(|s| s.trim()))
    .bind(input.kanji.as_ref().map(|s| s.trim()))
    .bind(input.position)
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

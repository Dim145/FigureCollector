//! Persistent display cabinets ("vitrines") — a per-user registry of named
//! locations for the shelf organiser.
//!
//! `owned_items.location` stays a free-text column; cabinets are matched to
//! items by name (case-insensitive). The registry exists so a user can create
//! an EMPTY cabinet that persists and acts as a drag-drop target, and so
//! cabinets can be ordered. Renaming a cabinet keeps its items in sync;
//! deleting one un-shelves its items (location → '').

use crate::error::{AppError, AppResult};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, PgPool};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct CollectionLocation {
    pub id: Uuid,
    pub name: String,
    pub position: i32,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct NewLocation {
    pub name: String,
}

#[derive(Debug, Deserialize)]
pub struct LocationPatch {
    #[serde(default)]
    pub name: Option<String>,
}

const RETURNING: &str = "id, name, position, created_at";

fn clean_name(name: &str) -> AppResult<String> {
    let n = name.trim();
    if n.is_empty() {
        return Err(AppError::BadRequest("location name required"));
    }
    if n.chars().count() > 80 {
        return Err(AppError::BadRequest("location name too long (max 80)"));
    }
    Ok(n.to_string())
}

pub async fn list(pool: &PgPool, user_id: Uuid) -> AppResult<Vec<CollectionLocation>> {
    Ok(sqlx::query_as::<_, CollectionLocation>(&format!(
        "SELECT {RETURNING} FROM collection_locations
         WHERE user_id = $1 ORDER BY position ASC, name ASC"
    ))
    .bind(user_id)
    .fetch_all(pool)
    .await?)
}

/// Create a cabinet. Idempotent: creating one whose name already exists (case-
/// insensitively) returns the existing row rather than erroring, so the SPA's
/// "+ new cabinet" never trips over a duplicate.
pub async fn create(
    pool: &PgPool,
    user_id: Uuid,
    input: NewLocation,
) -> AppResult<CollectionLocation> {
    let name = clean_name(&input.name)?;
    let id = Uuid::now_v7();
    Ok(sqlx::query_as::<_, CollectionLocation>(&format!(
        "INSERT INTO collection_locations (id, user_id, name, position)
         VALUES (
             $1, $2, $3,
             COALESCE((SELECT MAX(position) + 1 FROM collection_locations WHERE user_id = $2), 100)
         )
         ON CONFLICT (user_id, lower(name)) DO UPDATE SET name = EXCLUDED.name
         RETURNING {RETURNING}"
    ))
    .bind(id)
    .bind(user_id)
    .bind(&name)
    .fetch_one(pool)
    .await?)
}

/// Rename a cabinet and re-point its items in one transaction so the free-text
/// `owned_items.location` never drifts from the registry.
pub async fn patch(
    pool: &PgPool,
    user_id: Uuid,
    id: Uuid,
    input: LocationPatch,
) -> AppResult<CollectionLocation> {
    let Some(name) = input.name else {
        // Nothing to change — return the current row (or 404).
        return sqlx::query_as::<_, CollectionLocation>(&format!(
            "SELECT {RETURNING} FROM collection_locations WHERE id = $1 AND user_id = $2"
        ))
        .bind(id)
        .bind(user_id)
        .fetch_optional(pool)
        .await?
        .ok_or(AppError::NotFound);
    };
    let name = clean_name(&name)?;

    let mut tx = pool.begin().await?;
    let old: Option<(String,)> =
        sqlx::query_as("SELECT name FROM collection_locations WHERE id = $1 AND user_id = $2")
            .bind(id)
            .bind(user_id)
            .fetch_optional(&mut *tx)
            .await?;
    let Some((old_name,)) = old else {
        return Err(AppError::NotFound);
    };
    let row = sqlx::query_as::<_, CollectionLocation>(&format!(
        "UPDATE collection_locations SET name = $1 WHERE id = $2 AND user_id = $3 RETURNING {RETURNING}"
    ))
    .bind(&name)
    .bind(id)
    .bind(user_id)
    .fetch_one(&mut *tx)
    .await?;
    sqlx::query("UPDATE owned_items SET location = $1 WHERE user_id = $2 AND location = $3")
        .bind(&name)
        .bind(user_id)
        .bind(&old_name)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(row)
}

/// Delete a cabinet. Its items are un-shelved (location → '') so they reappear
/// in the "unshelved" group rather than vanishing.
pub async fn delete(pool: &PgPool, user_id: Uuid, id: Uuid) -> AppResult<()> {
    let mut tx = pool.begin().await?;
    let row: Option<(String,)> =
        sqlx::query_as("SELECT name FROM collection_locations WHERE id = $1 AND user_id = $2")
            .bind(id)
            .bind(user_id)
            .fetch_optional(&mut *tx)
            .await?;
    let Some((name,)) = row else {
        return Err(AppError::NotFound);
    };
    sqlx::query("UPDATE owned_items SET location = '' WHERE user_id = $1 AND location = $2")
        .bind(user_id)
        .bind(&name)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM collection_locations WHERE id = $1 AND user_id = $2")
        .bind(id)
        .bind(user_id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(())
}

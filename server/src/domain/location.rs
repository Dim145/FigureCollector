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
    /// Public share token (`/v/<token>`), or `None` when sharing is off. Kept
    /// out of the default list payload? No — the owner needs it to render the
    /// share panel, so it rides along here.
    pub share_token: Option<String>,
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

const RETURNING: &str = "id, name, position, created_at, share_token";

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
    // Match case-insensitively — cabinets bind to items by lower(name), so a
    // case-sensitive `location = $old` would orphan differently-cased items.
    sqlx::query(
        "UPDATE owned_items SET location = $1
         WHERE user_id = $2 AND lower(location) = lower($3)",
    )
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
    // Case-insensitive match (see rename) so every item under this cabinet,
    // whatever its casing, gets un-shelved rather than left dangling.
    sqlx::query(
        "UPDATE owned_items SET location = ''
         WHERE user_id = $1 AND lower(location) = lower($2)",
    )
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

// =============================================================================
// Public vitrine sharing (`collection_locations.share_token` + `/v/<token>`)
// =============================================================================

/// Enable public sharing for one of the user's cabinets: keep the existing
/// token if present, else mint one. Returns the live token. Idempotent —
/// calling twice yields the same `/v/<token>` link. Mirrors
/// `domain::gift::enable_share` (which it borrows `mint_token` from).
pub async fn enable_share(pool: &PgPool, user_id: Uuid, cabinet_id: Uuid) -> AppResult<String> {
    // Fast path: already shared → return the existing token (idempotent).
    let existing: Option<(Option<String>,)> = sqlx::query_as(
        "SELECT share_token FROM collection_locations WHERE id = $1 AND user_id = $2",
    )
    .bind(cabinet_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await?;
    match existing {
        None => return Err(AppError::NotFound),
        Some((Some(tok),)) => return Ok(tok),
        Some((None,)) => {}
    }

    // Retry on the (vanishingly rare) token collision.
    for _ in 0..5 {
        let tok = crate::domain::gift::mint_token();
        let res = sqlx::query(
            "UPDATE collection_locations SET share_token = $1
             WHERE id = $2 AND user_id = $3 AND share_token IS NULL",
        )
        .bind(&tok)
        .bind(cabinet_id)
        .bind(user_id)
        .execute(pool)
        .await;
        match res {
            Ok(r) if r.rows_affected() == 1 => return Ok(tok),
            // Either the cabinet vanished, or a token was set concurrently — re-read.
            Ok(_) => {
                let row: Option<(Option<String>,)> = sqlx::query_as(
                    "SELECT share_token FROM collection_locations WHERE id = $1 AND user_id = $2",
                )
                .bind(cabinet_id)
                .bind(user_id)
                .fetch_optional(pool)
                .await?;
                return match row {
                    Some((Some(tok),)) => Ok(tok),
                    _ => Err(AppError::NotFound),
                };
            }
            Err(sqlx::Error::Database(db)) if db.is_unique_violation() => continue,
            Err(e) => return Err(e.into()),
        }
    }
    Err(AppError::Internal(anyhow::anyhow!(
        "could not allocate a unique vitrine-share token"
    )))
}

/// Disable public sharing: clear the token (the `/v/<token>` link dies).
/// 404 if the cabinet isn't the user's.
pub async fn disable_share(pool: &PgPool, user_id: Uuid, cabinet_id: Uuid) -> AppResult<()> {
    let res = sqlx::query(
        "UPDATE collection_locations SET share_token = NULL WHERE id = $1 AND user_id = $2",
    )
    .bind(cabinet_id)
    .bind(user_id)
    .execute(pool)
    .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    Ok(())
}

/// One piece on a public cabinet view. Read-only and deliberately MINIMAL: it
/// exposes only what a display vitrine needs — names / photos / type / scale /
/// condition + the owner's pinned cover, plus boolean marketplace flags. No
/// monetary value, no asking price, no owner notes ever leave the server here
/// (the vitrine is a display surface, not a sale listing — stricter than the
/// public profile, which does publish an asking price for for-sale pieces).
#[derive(Debug, Serialize, FromRow)]
pub struct PublicCabinetEntry {
    pub figure_id: Uuid,
    pub figure_name: String,
    pub figure_slug: String,
    pub figure_type: String,
    pub figure_image: Option<String>,
    pub manufacturer_name: Option<String>,
    pub scale: Option<String>,
    pub height_mm: Option<i32>,
    pub version_name: Option<String>,
    pub condition: String,
    pub is_nsfw: bool,
    // Marketplace flags only (booleans, no price) — lets the public view badge a
    // piece as "for sale / for trade" without leaking any monetary value.
    pub for_sale: bool,
    pub for_trade: bool,
    // Owner's pinned cover so the SPA resolves the real cover, not catalog art
    // (same chain as /collection + the public profile).
    pub cover_photo_id: Option<Uuid>,
    pub cover_scan_id: Option<Uuid>,
    pub cover_photo_key: Option<String>,
    pub catalog_cover_photo_id: Option<Uuid>,
}

/// The public read-model for a shared cabinet: its name + its pieces.
pub struct PublicCabinet {
    pub cabinet_name: String,
    pub items: Vec<PublicCabinetEntry>,
}

/// Load a shared cabinet by token, read-only. Returns the cabinet's name + the
/// owner's pieces whose free-text `location` matches the cabinet name
/// (case-insensitive, exactly how the SPA buckets them). Returns the FULL set
/// (NSFW included); the route layer applies the NSFW gate (and counts hidden
/// pieces) in Rust, mirroring `routes::gift::public_list`. The token is the
/// only credential — this does NOT require `public_profile_enabled` (same
/// independence as the gift link).
pub async fn get_public_cabinet(pool: &PgPool, token: &str) -> AppResult<PublicCabinet> {
    let cabinet: Option<(Uuid, String)> = sqlx::query_as(
        "SELECT user_id, name FROM collection_locations WHERE share_token = $1",
    )
    .bind(token)
    .fetch_optional(pool)
    .await?;
    let Some((owner_id, cabinet_name)) = cabinet else {
        return Err(AppError::NotFound);
    };
    // The pieces are scoped to the cabinet's owner; the route resolves the
    // owner's public identity separately from the same token.

    let items: Vec<PublicCabinetEntry> = sqlx::query_as(
        "SELECT
            o.figure_id, f.name AS figure_name, f.slug AS figure_slug,
            f.figure_type, f.official_image_url AS figure_image,
            m.name AS manufacturer_name, f.scale, f.height_mm, f.version_name,
            o.condition, f.is_nsfw,
            o.for_sale, o.for_trade,
            o.cover_photo_id, o.cover_scan_id,
            (SELECT ph.storage_key FROM photos ph WHERE ph.id = o.cover_photo_id) AS cover_photo_key,
            (SELECT fp.id FROM figure_photos fp
               WHERE fp.figure_id = o.figure_id
               ORDER BY fp.is_primary DESC, fp.position ASC, fp.created_at ASC
               LIMIT 1) AS catalog_cover_photo_id
         FROM owned_items o
         JOIN figures f            ON f.id = o.figure_id
         LEFT JOIN manufacturers m ON m.id = f.manufacturer_id
         WHERE o.user_id = $1
           AND lower(o.location) = lower($2)
         ORDER BY o.sort_order ASC NULLS LAST, o.created_at DESC",
    )
    .bind(owner_id)
    .bind(&cabinet_name)
    .fetch_all(pool)
    .await?;

    Ok(PublicCabinet {
        cabinet_name,
        items,
    })
}

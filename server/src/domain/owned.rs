//! User collection (owned_items) repository.

use crate::error::{AppError, AppResult};
use chrono::{DateTime, NaiveDate, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, PgPool};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct OwnedItem {
    pub id: Uuid,
    pub user_id: Uuid,
    pub figure_id: Uuid,
    pub condition: String,
    pub price_amount: Option<Decimal>,
    pub price_currency: Option<String>,
    pub store: Option<String>,
    pub purchase_date: Option<NaiveDate>,
    pub location: Option<String>,
    pub notes: Option<String>,
    pub cover_photo_id: Option<Uuid>,
    pub cover_scan_id: Option<Uuid>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct OwnedItemWithFigure {
    pub id: Uuid,
    pub figure_id: Uuid,
    pub condition: String,
    pub price_amount: Option<Decimal>,
    pub price_currency: Option<String>,
    pub store: Option<String>,
    pub purchase_date: Option<NaiveDate>,
    pub location: Option<String>,
    pub notes: Option<String>,
    pub created_at: DateTime<Utc>,

    pub figure_name: String,
    pub figure_slug: String,
    pub figure_type: String,
    pub figure_image: Option<String>,
    pub manufacturer_name: Option<String>,
    pub scale: Option<String>,
    pub height_mm: Option<i32>,
    pub version_name: Option<String>,

    /// Per-user cover preference. Either `cover_photo_id` (a `photos` row),
    /// `cover_scan_id` (a `scans` row), or both null — in the latter case
    /// the SPA falls back to the catalog's primary photo or `figure_image`.
    pub cover_photo_id: Option<Uuid>,
    pub cover_scan_id: Option<Uuid>,
    /// Catalogue-side primary photo id, joined here so the SPA doesn't have
    /// to re-query per row. Used purely as a fallback when no per-user
    /// cover is set.
    pub catalog_cover_photo_id: Option<Uuid>,

    /// Catalog-side release date — used to derive "pre-order" status when no
    /// linked preorder row exists yet (race between owned creation and the
    /// auto-preorder insert is impossible thanks to the transaction, but a
    /// user could also have a manually-created preorder linkage).
    pub figure_release_date: Option<NaiveDate>,
    /// Preorder lifecycle, joined from the auto-linked preorders row when
    /// one exists. `None` for plain pieces (released + received).
    pub preorder_status: Option<String>,
    pub preorder_release_current: Option<NaiveDate>,
    pub is_nsfw: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct NewOwnedItem {
    pub figure_id: Uuid,
    #[serde(default = "default_condition")]
    pub condition: String,
    pub price_amount: Option<Decimal>,
    pub price_currency: Option<String>,
    pub store: Option<String>,
    pub purchase_date: Option<NaiveDate>,
    pub location: Option<String>,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct OwnedPatch {
    pub condition: Option<String>,
    pub price_amount: Option<Decimal>,
    pub price_currency: Option<String>,
    pub store: Option<String>,
    pub purchase_date: Option<NaiveDate>,
    pub location: Option<String>,
    pub notes: Option<String>,
}

fn default_condition() -> String {
    "mib_sealed".to_string()
}

const ALLOWED_CONDITIONS: &[&str] = &["mib_sealed", "opened_box", "displayed", "loose", "damaged"];

const OWNED_RETURNING: &str =
    "id, user_id, figure_id, condition, price_amount, price_currency, \
     store, purchase_date, location, notes, cover_photo_id, cover_scan_id, \
     created_at, updated_at";

pub async fn create(pool: &PgPool, user_id: Uuid, input: NewOwnedItem) -> AppResult<OwnedItem> {
    if !ALLOWED_CONDITIONS.contains(&input.condition.as_str()) {
        return Err(AppError::BadRequest("invalid condition"));
    }
    if let Some(c) = &input.price_currency {
        if c.len() != 3 {
            return Err(AppError::BadRequest("price_currency must be ISO 4217 (3 chars)"));
        }
    }
    if input.notes.as_deref().is_some_and(|n| n.len() > 4096) {
        return Err(AppError::BadRequest("notes too long (max 4096)"));
    }

    let id = Uuid::now_v7();
    let sql = format!(
        "INSERT INTO owned_items (
            id, user_id, figure_id, condition, price_amount, price_currency,
            store, purchase_date, location, notes
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         RETURNING {OWNED_RETURNING}"
    );

    sqlx::query_as(&sql)
        .bind(id)
        .bind(user_id)
        .bind(input.figure_id)
        .bind(&input.condition)
        .bind(input.price_amount)
        .bind(&input.price_currency)
        .bind(&input.store)
        .bind(input.purchase_date)
        .bind(&input.location)
        .bind(&input.notes)
        .fetch_one(pool)
        .await
        .map_err(|e| match e {
            sqlx::Error::Database(ref db) if db.is_foreign_key_violation() => {
                AppError::BadRequest("figure_id does not exist")
            }
            other => AppError::Db(other),
        })
}

pub async fn patch(
    pool: &PgPool,
    user_id: Uuid,
    id: Uuid,
    input: OwnedPatch,
) -> AppResult<OwnedItem> {
    if let Some(c) = &input.condition {
        if !ALLOWED_CONDITIONS.contains(&c.as_str()) {
            return Err(AppError::BadRequest("invalid condition"));
        }
    }

    let sql = format!(
        "UPDATE owned_items SET
            condition      = COALESCE($1, condition),
            price_amount   = COALESCE($2, price_amount),
            price_currency = COALESCE($3, price_currency),
            store          = COALESCE($4, store),
            purchase_date  = COALESCE($5, purchase_date),
            location       = COALESCE($6, location),
            notes          = COALESCE($7, notes)
         WHERE id = $8 AND user_id = $9
         RETURNING {OWNED_RETURNING}"
    );

    let row: Option<OwnedItem> = sqlx::query_as(&sql)
        .bind(&input.condition)
        .bind(input.price_amount)
        .bind(&input.price_currency)
        .bind(&input.store)
        .bind(input.purchase_date)
        .bind(&input.location)
        .bind(&input.notes)
        .bind(id)
        .bind(user_id)
        .fetch_optional(pool)
        .await?;

    row.ok_or(AppError::NotFound)
}

pub async fn list_for_user(
    pool: &PgPool,
    user_id: Uuid,
    exclude_nsfw: bool,
) -> AppResult<Vec<OwnedItemWithFigure>> {
    // `catalog_cover_photo_id` is resolved here so the SPA can build the
    // fallback `/api/figure-photos/{id}` URL without a second roundtrip per
    // row. `is_primary DESC` puts the primary first when one exists, then
    // falls back to position order.
    let mut sql = String::from(
        "SELECT
            o.id, o.figure_id, o.condition, o.price_amount, o.price_currency,
            o.store, o.purchase_date, o.location, o.notes, o.created_at,
            f.name AS figure_name, f.slug AS figure_slug, f.figure_type,
            f.official_image_url AS figure_image,
            m.name AS manufacturer_name,
            f.scale, f.height_mm, f.version_name,
            o.cover_photo_id, o.cover_scan_id,
            (
                SELECT fp.id FROM figure_photos fp
                WHERE fp.figure_id = o.figure_id
                ORDER BY fp.is_primary DESC, fp.position ASC, fp.created_at ASC
                LIMIT 1
            ) AS catalog_cover_photo_id,
            f.release_date          AS figure_release_date,
            p.status                AS preorder_status,
            p.release_date_current  AS preorder_release_current,
            f.is_nsfw
         FROM owned_items o
         JOIN figures f          ON f.id = o.figure_id
         LEFT JOIN manufacturers m ON m.id = f.manufacturer_id
         LEFT JOIN preorders p   ON p.owned_item_id = o.id
         WHERE o.user_id = $1",
    );
    if exclude_nsfw {
        sql.push_str(" AND NOT f.is_nsfw");
    }
    sql.push_str(" ORDER BY o.created_at DESC");
    Ok(sqlx::query_as::<_, OwnedItemWithFigure>(&sql)
        .bind(user_id)
        .fetch_all(pool)
        .await?)
}

/// Patch the cover preference for a single owned item. Either field can be
/// passed (or both `None` to clear); the schema check ensures we never have
/// both set at once.
#[derive(Debug, Clone, Deserialize)]
pub struct CoverPatch {
    /// `Some(None)` clears; `Some(Some(id))` sets; `None` leaves unchanged.
    /// Serde models this with `default + skip_serializing_if`; the wrapper
    /// `Option<Option<T>>` doesn't deserialise cleanly so we expose two flags
    /// + ids instead.
    #[serde(default)]
    pub photo_id: Option<Uuid>,
    #[serde(default)]
    pub scan_id: Option<Uuid>,
    /// Pass `true` to explicitly clear both cover fields.
    #[serde(default)]
    pub clear: bool,
}

pub async fn set_cover(
    pool: &PgPool,
    user_id: Uuid,
    owned_id: Uuid,
    patch: CoverPatch,
) -> AppResult<OwnedItem> {
    if patch.photo_id.is_some() && patch.scan_id.is_some() {
        return Err(AppError::BadRequest(
            "cover can be a photo OR a scan, not both",
        ));
    }

    // Validate ownership of the referenced photo/scan ID so a user can't
    // pin someone else's image as their cover.
    if let Some(pid) = patch.photo_id {
        let owns: Option<(Uuid,)> = sqlx::query_as(
            "SELECT p.id FROM photos p
             JOIN owned_items o ON o.id = p.owned_item_id
             WHERE p.id = $1 AND o.user_id = $2 AND o.id = $3",
        )
        .bind(pid)
        .bind(user_id)
        .bind(owned_id)
        .fetch_optional(pool)
        .await?;
        if owns.is_none() {
            return Err(AppError::BadRequest(
                "photo_id does not belong to this owned item",
            ));
        }
    }
    if let Some(sid) = patch.scan_id {
        let owns: Option<(Uuid,)> = sqlx::query_as(
            "SELECT s.id FROM scans s
             JOIN owned_items o ON o.id = s.owned_item_id
             WHERE s.id = $1 AND o.user_id = $2 AND o.id = $3",
        )
        .bind(sid)
        .bind(user_id)
        .bind(owned_id)
        .fetch_optional(pool)
        .await?;
        if owns.is_none() {
            return Err(AppError::BadRequest(
                "scan_id does not belong to this owned item",
            ));
        }
    }

    let (photo_id, scan_id) = if patch.clear {
        (None, None)
    } else {
        (patch.photo_id, patch.scan_id)
    };

    let sql = format!(
        "UPDATE owned_items
         SET cover_photo_id = $1, cover_scan_id = $2
         WHERE id = $3 AND user_id = $4
         RETURNING {OWNED_RETURNING}"
    );
    let row: Option<OwnedItem> = sqlx::query_as(&sql)
        .bind(photo_id)
        .bind(scan_id)
        .bind(owned_id)
        .bind(user_id)
        .fetch_optional(pool)
        .await?;
    row.ok_or(AppError::NotFound)
}

pub async fn delete_for_user(pool: &PgPool, user_id: Uuid, id: Uuid) -> AppResult<()> {
    let result = sqlx::query("DELETE FROM owned_items WHERE id = $1 AND user_id = $2")
        .bind(id)
        .bind(user_id)
        .execute(pool)
        .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    Ok(())
}

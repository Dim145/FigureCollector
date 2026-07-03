//! User wishlist (`wishlist_items`) repository.
//!
//! Each row references a catalogue figure (`figure_id` FK); display fields are
//! joined from `figures` / `manufacturers`. `max_price_amount` is the user's
//! target price (the "cible"); `note` a free-text reminder.

use crate::error::{AppError, AppResult};
use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, PgPool};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct WishlistItem {
    pub figure_id: Uuid,
    pub max_price_amount: Option<Decimal>,
    pub max_price_currency: Option<String>,
    pub note: Option<String>,
    pub created_at: DateTime<Utc>,
    // ── joined from the catalogue ──
    pub figure_name: String,
    pub figure_slug: String,
    pub figure_type: String,
    pub figure_image: Option<String>,
    pub manufacturer_name: Option<String>,
    pub scale: Option<String>,
    pub msrp_amount: Option<Decimal>,
    pub msrp_currency: Option<String>,
    /// Latest market price observed by the price cron (None when never
    /// priced) — the SPA's "deal met" check prefers it over the MSRP.
    pub provider_price_amount: Option<Decimal>,
    pub provider_price_currency: Option<String>,
    pub is_nsfw: bool,
    /// Catalogue primary photo id (cover fallback), so the SPA builds the
    /// `/api/figure-photos/{id}` URL without a second query per row.
    pub catalog_cover_photo_id: Option<Uuid>,
}

#[derive(Debug, Deserialize)]
pub struct NewWishlistItem {
    pub figure_id: Uuid,
    #[serde(default)]
    pub max_price_amount: Option<Decimal>,
    #[serde(default)]
    pub max_price_currency: Option<String>,
    #[serde(default)]
    pub note: Option<String>,
}

/// Direct-set patch (no COALESCE): a `null` field clears it, so the editor can
/// drop a target price / note. The SPA sends the full intended state.
#[derive(Debug, Deserialize)]
pub struct WishlistPatch {
    #[serde(default)]
    pub max_price_amount: Option<Decimal>,
    #[serde(default)]
    pub max_price_currency: Option<String>,
    #[serde(default)]
    pub note: Option<String>,
}

const SELECT: &str = "
    SELECT w.figure_id, w.max_price_amount, w.max_price_currency, w.note, w.created_at,
           f.name AS figure_name, f.slug AS figure_slug, f.figure_type,
           f.official_image_url AS figure_image,
           m.name AS manufacturer_name, f.scale,
           f.msrp_amount, f.msrp_currency,
           pp.amount   AS provider_price_amount,
           pp.currency AS provider_price_currency,
           f.is_nsfw,
           (
               SELECT fp.id FROM figure_photos fp
               WHERE fp.figure_id = f.id
               ORDER BY fp.is_primary DESC, fp.position ASC, fp.created_at ASC
               LIMIT 1
           ) AS catalog_cover_photo_id
    FROM wishlist_items w
    JOIN figures f          ON f.id = w.figure_id
    LEFT JOIN figure_provider_prices pp ON pp.figure_id = f.id
    LEFT JOIN manufacturers m ON m.id = f.manufacturer_id";

fn check_currency(c: &Option<String>) -> AppResult<()> {
    if let Some(c) = c {
        if !crate::domain::currency::is_supported(c) {
            return Err(AppError::BadRequest(
                "max_price_currency must be a supported currency code",
            ));
        }
    }
    Ok(())
}

pub async fn list(pool: &PgPool, user_id: Uuid, exclude_nsfw: bool) -> AppResult<Vec<WishlistItem>> {
    let mut sql = format!("{SELECT} WHERE w.user_id = $1");
    if exclude_nsfw {
        sql.push_str(" AND NOT f.is_nsfw");
    }
    sql.push_str(" ORDER BY w.created_at DESC, w.figure_id DESC");
    Ok(sqlx::query_as::<_, WishlistItem>(&sql)
        .bind(user_id)
        .fetch_all(pool)
        .await?)
}

async fn find_one(pool: &PgPool, user_id: Uuid, figure_id: Uuid) -> AppResult<WishlistItem> {
    let sql = format!("{SELECT} WHERE w.user_id = $1 AND w.figure_id = $2");
    sqlx::query_as::<_, WishlistItem>(&sql)
        .bind(user_id)
        .bind(figure_id)
        .fetch_optional(pool)
        .await?
        .ok_or(AppError::NotFound)
}

/// Add a figure to the wishlist. Idempotent: re-adding an already-wished figure
/// updates its target price / note rather than erroring.
pub async fn add(pool: &PgPool, user_id: Uuid, input: NewWishlistItem) -> AppResult<WishlistItem> {
    check_currency(&input.max_price_currency)?;

    // "owned ≠ wishlist": a figure already ACTIVELY owned can't be wished for
    // (an archived/cancelled owned item leaves the user free to re-wish it).
    // The not-owned check is pushed INTO the INSERT (`… SELECT … WHERE NOT
    // EXISTS`) so it's evaluated atomically at insert time — a concurrent
    // add-to-collection can't slip between a separate check and the write
    // (a plain transaction wouldn't help: READ COMMITTED re-snapshots per
    // statement). Idempotent: re-adding an already-wished figure updates it.
    let res = sqlx::query(
        "INSERT INTO wishlist_items (user_id, figure_id, max_price_amount, max_price_currency, note)
         SELECT $1, $2, $3, $4, $5
         WHERE NOT EXISTS (
             SELECT 1 FROM owned_items
             WHERE user_id = $1 AND figure_id = $2 AND archived_at IS NULL
         )
         ON CONFLICT (user_id, figure_id) DO UPDATE SET
             max_price_amount   = EXCLUDED.max_price_amount,
             max_price_currency = EXCLUDED.max_price_currency,
             note               = EXCLUDED.note",
    )
    .bind(user_id)
    .bind(input.figure_id)
    .bind(input.max_price_amount)
    .bind(&input.max_price_currency)
    .bind(&input.note)
    .execute(pool)
    .await
    .map_err(|e| match e {
        sqlx::Error::Database(ref db) if db.is_foreign_key_violation() => {
            AppError::BadRequest("figure_id does not exist")
        }
        other => AppError::Db(other),
    })?;

    // 0 rows ⇒ the NOT EXISTS guard fired ⇒ the figure is actively owned.
    if res.rows_affected() == 0 {
        return Err(AppError::Conflict("figure is already in your collection"));
    }

    find_one(pool, user_id, input.figure_id).await
}

pub async fn patch(
    pool: &PgPool,
    user_id: Uuid,
    figure_id: Uuid,
    input: WishlistPatch,
) -> AppResult<WishlistItem> {
    check_currency(&input.max_price_currency)?;
    let res = sqlx::query(
        "UPDATE wishlist_items
         SET max_price_amount = $1, max_price_currency = $2, note = $3
         WHERE user_id = $4 AND figure_id = $5",
    )
    .bind(input.max_price_amount)
    .bind(&input.max_price_currency)
    .bind(&input.note)
    .bind(user_id)
    .bind(figure_id)
    .execute(pool)
    .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    find_one(pool, user_id, figure_id).await
}

pub async fn remove(pool: &PgPool, user_id: Uuid, figure_id: Uuid) -> AppResult<()> {
    let res = sqlx::query("DELETE FROM wishlist_items WHERE user_id = $1 AND figure_id = $2")
        .bind(user_id)
        .bind(figure_id)
        .execute(pool)
        .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    Ok(())
}

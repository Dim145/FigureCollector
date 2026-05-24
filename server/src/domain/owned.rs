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
     store, purchase_date, location, notes, created_at, updated_at";

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

pub async fn list_for_user(pool: &PgPool, user_id: Uuid) -> AppResult<Vec<OwnedItemWithFigure>> {
    Ok(sqlx::query_as::<_, OwnedItemWithFigure>(
        "SELECT
            o.id, o.figure_id, o.condition, o.price_amount, o.price_currency,
            o.store, o.purchase_date, o.location, o.notes, o.created_at,
            f.name AS figure_name, f.slug AS figure_slug, f.figure_type,
            f.official_image_url AS figure_image,
            m.name AS manufacturer_name,
            f.scale, f.height_mm
         FROM owned_items o
         JOIN figures f         ON f.id = o.figure_id
         LEFT JOIN manufacturers m ON m.id = f.manufacturer_id
         WHERE o.user_id = $1
         ORDER BY o.created_at DESC",
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?)
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

//! Pre-orders + release date slip history.
//!
//! When the user revises `release_date_current`, the previous value lands in
//! `preorder_date_history` automatically (in the same transaction).

use crate::error::{AppError, AppResult};
use chrono::{DateTime, NaiveDate, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, PgPool};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct Preorder {
    pub id: Uuid,
    pub user_id: Uuid,
    pub figure_id: Uuid,
    pub status: String,
    /// FK to `stores`. Replaced the free-text `store` column in migration 22.
    /// Callers send the *name* in NewPreorder / PreorderPatch and the
    /// handler resolves it via `store::find_or_create`.
    pub store_id: Option<Uuid>,
    pub order_ref: Option<String>,
    /// Optional tracking URL — the carrier + tracking number are parsed
    /// from this URL client-side (UPS, DHL, Colissimo, …).
    pub tracking_url: Option<String>,
    pub release_date_original: Option<NaiveDate>,
    pub release_date_current: Option<NaiveDate>,
    pub price_amount: Option<Decimal>,
    pub price_currency: Option<String>,
    /// Acompte paid up-front at preorder time (e.g. 30 € on a 200 €
    /// figurine). Part of `price_amount`, not in addition to it.
    pub deposit_amount: Option<Decimal>,
    /// What was actually paid back when the preorder is cancelled.
    /// See migration 19 header for the full semantics.
    pub deposit_refund_amount: Option<Decimal>,
    /// Auto-set on the status='shipped' transition. Combined with
    /// `estimated_delivery_days` to project a delivery date.
    pub shipped_at: Option<DateTime<Utc>>,
    pub estimated_delivery_days: Option<i32>,
    pub notes: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct PreorderWithFigure {
    pub id: Uuid,
    pub figure_id: Uuid,
    /// FK back to the auto-linked owned_item, when one exists. The SPA
    /// uses this to drive the cancellation dialog (archive vs delete).
    pub owned_item_id: Option<Uuid>,
    pub status: String,
    /// Joined from `stores` — populated alongside `store_id` so the SPA
    /// can render the chip + link to /stores/<slug> without a second
    /// roundtrip.
    pub store_id: Option<Uuid>,
    pub store_name: Option<String>,
    pub store_slug: Option<String>,
    pub order_ref: Option<String>,
    pub tracking_url: Option<String>,
    pub release_date_original: Option<NaiveDate>,
    pub release_date_current: Option<NaiveDate>,
    pub price_amount: Option<Decimal>,
    pub price_currency: Option<String>,
    pub deposit_amount: Option<Decimal>,
    pub deposit_refund_amount: Option<Decimal>,
    pub shipped_at: Option<DateTime<Utc>>,
    pub estimated_delivery_days: Option<i32>,
    pub notes: Option<String>,
    pub created_at: DateTime<Utc>,

    pub figure_name: String,
    pub figure_slug: String,
    pub figure_type: String,
    pub figure_image: Option<String>,
    pub manufacturer_name: Option<String>,
    pub slip_count: i64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct NewPreorder {
    pub figure_id: Uuid,
    #[serde(default = "default_status")]
    pub status: String,
    pub store: Option<String>,
    pub order_ref: Option<String>,
    pub tracking_url: Option<String>,
    pub release_date: Option<NaiveDate>,
    pub price_amount: Option<Decimal>,
    pub price_currency: Option<String>,
    pub deposit_amount: Option<Decimal>,
    pub deposit_refund_amount: Option<Decimal>,
    pub estimated_delivery_days: Option<i32>,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PreorderPatch {
    pub status: Option<String>,
    pub store: Option<String>,
    pub order_ref: Option<String>,
    pub tracking_url: Option<String>,
    pub release_date: Option<NaiveDate>,
    pub release_date_note: Option<String>,
    pub price_amount: Option<Decimal>,
    pub price_currency: Option<String>,
    pub deposit_amount: Option<Decimal>,
    /// Special semantics for PATCH: pass an explicit `null` JSON literal
    /// to CLEAR the refund (e.g. when un-cancelling). Omitting the field
    /// leaves it unchanged via COALESCE — see the patch SQL.
    pub deposit_refund_amount: Option<Decimal>,
    pub estimated_delivery_days: Option<i32>,
    pub notes: Option<String>,
}

fn default_status() -> String {
    "preordered".to_string()
}

const ALLOWED_STATUS: &[&str] = &[
    "announced",
    "preorder_open",
    "preordered",
    "in_production",
    "released",
    "shipped",
    "received",
    "cancelled",
];

pub async fn create(pool: &PgPool, user_id: Uuid, input: NewPreorder) -> AppResult<Preorder> {
    if !ALLOWED_STATUS.contains(&input.status.as_str()) {
        return Err(AppError::BadRequest("invalid status"));
    }

    // Resolve free-text store name → stores.id (find-or-create by slug).
    let store_id = match input.store.as_deref() {
        Some(name) => super::store::find_or_create(pool, name).await?,
        None => None,
    };

    let id = Uuid::now_v7();

    sqlx::query_as::<_, Preorder>(
        "INSERT INTO preorders (
            id, user_id, figure_id, status, store_id, order_ref, tracking_url,
            release_date_original, release_date_current,
            price_amount, price_currency, deposit_amount, deposit_refund_amount,
            estimated_delivery_days, shipped_at, notes
         ) VALUES (
            $1,$2,$3,$4,$5,$6,$7,$8,$8,$9,$10,$11,$12,$13,
            CASE WHEN $4 = 'shipped' THEN NOW() ELSE NULL END,
            $14
         )
         RETURNING id, user_id, figure_id, status, store_id, order_ref, tracking_url,
                   release_date_original, release_date_current,
                   price_amount, price_currency, deposit_amount,
                   deposit_refund_amount, shipped_at, estimated_delivery_days,
                   notes,
                   created_at, updated_at",
    )
    .bind(id)
    .bind(user_id)
    .bind(input.figure_id)
    .bind(&input.status)
    .bind(store_id)
    .bind(&input.order_ref)
    .bind(&input.tracking_url)
    .bind(input.release_date)
    .bind(input.price_amount)
    .bind(&input.price_currency)
    .bind(input.deposit_amount)
    .bind(input.deposit_refund_amount)
    .bind(input.estimated_delivery_days)
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

pub async fn list_for_user(pool: &PgPool, user_id: Uuid) -> AppResult<Vec<PreorderWithFigure>> {
    Ok(sqlx::query_as::<_, PreorderWithFigure>(
        "SELECT
            p.id, p.figure_id, p.owned_item_id, p.status,
            p.store_id,
            st.name AS store_name,
            st.slug AS store_slug,
            p.order_ref, p.tracking_url,
            p.release_date_original, p.release_date_current,
            p.price_amount, p.price_currency,
            p.deposit_amount, p.deposit_refund_amount,
            p.shipped_at, p.estimated_delivery_days,
            p.notes,
            p.created_at,
            f.name AS figure_name, f.slug AS figure_slug, f.figure_type,
            f.official_image_url AS figure_image,
            m.name AS manufacturer_name,
            COALESCE((SELECT COUNT(*) FROM preorder_date_history h WHERE h.preorder_id = p.id), 0) AS slip_count
         FROM preorders p
         JOIN figures f         ON f.id = p.figure_id
         LEFT JOIN manufacturers m ON m.id = f.manufacturer_id
         LEFT JOIN stores st     ON st.id = p.store_id
         WHERE p.user_id = $1
         ORDER BY
            CASE WHEN p.status IN ('received','cancelled') THEN 1 ELSE 0 END,
            p.release_date_current ASC NULLS LAST,
            p.created_at DESC",
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?)
}

pub async fn patch(
    pool: &PgPool,
    user_id: Uuid,
    id: Uuid,
    input: PreorderPatch,
) -> AppResult<Preorder> {
    if let Some(s) = &input.status {
        if !ALLOWED_STATUS.contains(&s.as_str()) {
            return Err(AppError::BadRequest("invalid status"));
        }
    }

    // Free-text store name → stores.id (same find-or-create flow as on
    // owned_items). Done outside the tx because find_or_create may itself
    // insert into `stores` — that insert wants its own tx semantics.
    let store_id = match input.store.as_deref() {
        Some(name) => super::store::find_or_create(pool, name).await?,
        None => None,
    };

    let mut tx = pool.begin().await?;

    let current: Option<Preorder> = sqlx::query_as(
        "SELECT id, user_id, figure_id, status, store_id, order_ref, tracking_url,
                release_date_original, release_date_current,
                price_amount, price_currency,
                deposit_amount, deposit_refund_amount,
                shipped_at, estimated_delivery_days, notes,
                created_at, updated_at
         FROM preorders WHERE id = $1 AND user_id = $2",
    )
    .bind(id)
    .bind(user_id)
    .fetch_optional(&mut *tx)
    .await?;

    let current = current.ok_or(AppError::NotFound)?;

    // If release_date changed, log it.
    if let Some(new_date) = input.release_date {
        if Some(new_date) != current.release_date_current {
            sqlx::query(
                "INSERT INTO preorder_date_history (preorder_id, previous_date, new_date, source, note)
                 VALUES ($1, $2, $3, 'user', $4)",
            )
            .bind(id)
            .bind(current.release_date_current)
            .bind(new_date)
            .bind(&input.release_date_note)
            .execute(&mut *tx)
            .await?;
        }
    }

    let updated: Preorder = sqlx::query_as(
        "UPDATE preorders SET
            status                  = COALESCE($1, status),
            store_id                = COALESCE($2, store_id),
            order_ref               = COALESCE($3, order_ref),
            tracking_url            = COALESCE($4, tracking_url),
            release_date_current    = COALESCE($5, release_date_current),
            price_amount            = COALESCE($6, price_amount),
            price_currency          = COALESCE($7, price_currency),
            deposit_amount          = COALESCE($8, deposit_amount),
            deposit_refund_amount   = COALESCE($9, deposit_refund_amount),
            estimated_delivery_days = COALESCE($10, estimated_delivery_days),
            -- Auto-stamp shipped_at on the FIRST transition to 'shipped'.
            -- COALESCE keeps any previous value so re-saving the same
            -- status doesn't reset the timestamp.
            shipped_at              = CASE
                WHEN $1 = 'shipped' AND shipped_at IS NULL THEN NOW()
                ELSE shipped_at
            END,
            notes                   = COALESCE($11, notes)
         WHERE id = $12 AND user_id = $13
         RETURNING id, user_id, figure_id, status, store_id, order_ref, tracking_url,
                   release_date_original, release_date_current,
                   price_amount, price_currency,
                   deposit_amount, deposit_refund_amount,
                   shipped_at, estimated_delivery_days, notes,
                   created_at, updated_at",
    )
    .bind(&input.status)
    .bind(store_id)
    .bind(&input.order_ref)
    .bind(&input.tracking_url)
    .bind(input.release_date)
    .bind(input.price_amount)
    .bind(&input.price_currency)
    .bind(input.deposit_amount)
    .bind(input.deposit_refund_amount)
    .bind(input.estimated_delivery_days)
    .bind(&input.notes)
    .bind(id)
    .bind(user_id)
    .fetch_one(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok(updated)
}

pub async fn delete_for_user(pool: &PgPool, user_id: Uuid, id: Uuid) -> AppResult<()> {
    let res = sqlx::query("DELETE FROM preorders WHERE id = $1 AND user_id = $2")
        .bind(id)
        .bind(user_id)
        .execute(pool)
        .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct DateHistoryEntry {
    pub id: Uuid,
    pub previous_date: Option<NaiveDate>,
    pub new_date: Option<NaiveDate>,
    pub source: String,
    pub note: Option<String>,
    pub noted_at: DateTime<Utc>,
}

pub async fn history(
    pool: &PgPool,
    user_id: Uuid,
    id: Uuid,
) -> AppResult<Vec<DateHistoryEntry>> {
    // Make sure the preorder belongs to this user before returning history.
    let owned: Option<(Uuid,)> =
        sqlx::query_as("SELECT id FROM preorders WHERE id = $1 AND user_id = $2")
            .bind(id)
            .bind(user_id)
            .fetch_optional(pool)
            .await?;
    if owned.is_none() {
        return Err(AppError::NotFound);
    }

    Ok(sqlx::query_as::<_, DateHistoryEntry>(
        "SELECT id, previous_date, new_date, source, note, noted_at
         FROM preorder_date_history
         WHERE preorder_id = $1
         ORDER BY noted_at DESC",
    )
    .bind(id)
    .fetch_all(pool)
    .await?)
}

#[derive(Debug, Clone, serde::Deserialize)]
pub struct HistoryEntryPatch {
    pub note: Option<String>,
}

/// Edit the free-form note on a single slip-history entry. We only allow
/// editing the note — dates and source are immutable historical record.
/// Returns the patched entry. Authorisation: the entry's parent preorder
/// must belong to `user_id`, otherwise `NotFound`.
pub async fn patch_history_note(
    pool: &PgPool,
    user_id: Uuid,
    preorder_id: Uuid,
    entry_id: Uuid,
    input: HistoryEntryPatch,
) -> AppResult<DateHistoryEntry> {
    // Verify the entry belongs to a preorder owned by this user in one query.
    let row: Option<DateHistoryEntry> = sqlx::query_as(
        "UPDATE preorder_date_history
         SET note = $1
         WHERE id = $2
           AND preorder_id = $3
           AND preorder_id IN (SELECT id FROM preorders WHERE user_id = $4)
         RETURNING id, previous_date, new_date, source, note, noted_at",
    )
    .bind(input.note.as_deref().map(str::trim).filter(|s| !s.is_empty()))
    .bind(entry_id)
    .bind(preorder_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await?;
    row.ok_or(AppError::NotFound)
}

// -----------------------------------------------------------------------------
// Linked preorder lifecycle
// -----------------------------------------------------------------------------

/// Auto-create a preorder row tied to an owned_item, fired by the owned-items
/// route when the figure has a future release_date. Idempotent — the unique
/// index on (owned_item_id) means re-running this for the same owned_item is
/// a no-op via ON CONFLICT.
pub async fn create_for_owned_item(
    pool: &PgPool,
    user_id: Uuid,
    owned_item_id: Uuid,
    figure_id: Uuid,
    release_date: NaiveDate,
) -> AppResult<Preorder> {
    let id = Uuid::now_v7();
    let row: Preorder = sqlx::query_as(
        "INSERT INTO preorders (
             id, user_id, figure_id, owned_item_id, status,
             release_date_original, release_date_current
         ) VALUES ($1, $2, $3, $4, 'preordered', $5, $5)
         ON CONFLICT (owned_item_id) WHERE owned_item_id IS NOT NULL
         DO UPDATE SET release_date_current = EXCLUDED.release_date_current
         RETURNING id, user_id, figure_id, status, store_id, order_ref, tracking_url,
                   release_date_original, release_date_current,
                   price_amount, price_currency,
                   deposit_amount, deposit_refund_amount,
                   shipped_at, estimated_delivery_days, notes,
                   created_at, updated_at",
    )
    .bind(id)
    .bind(user_id)
    .bind(figure_id)
    .bind(owned_item_id)
    .bind(release_date)
    .fetch_one(pool)
    .await?;
    Ok(row)
}

/// Best-effort: returns the preorder bound to this owned_item, if any. Used
/// by the figure-detail page to render the "Historique de pré-commande"
/// section.
pub async fn find_by_owned_item(
    pool: &PgPool,
    user_id: Uuid,
    owned_item_id: Uuid,
) -> AppResult<Option<Preorder>> {
    Ok(sqlx::query_as::<_, Preorder>(
        "SELECT id, user_id, figure_id, status, store_id, order_ref, tracking_url,
                release_date_original, release_date_current,
                price_amount, price_currency,
                deposit_amount, deposit_refund_amount,
                shipped_at, estimated_delivery_days, notes,
                created_at, updated_at
         FROM preorders WHERE owned_item_id = $1 AND user_id = $2",
    )
    .bind(owned_item_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await?)
}

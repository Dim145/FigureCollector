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
    /// Shipping/handling cost in the same currency as `price_amount`.
    /// Stored separately so the figure cost stays comparable to the
    /// catalog MSRP; total paid = `price_amount + shipping_amount`.
    pub shipping_amount: Option<Decimal>,
    /// Manual current / market value (the "cote"). Null → the SPA falls back
    /// to the figure's catalog MSRP. Currency held in `value_currency`.
    pub value_amount: Option<Decimal>,
    pub value_currency: Option<String>,
    /// Marketplace flags — the owner can list a piece "for sale" and/or "for
    /// trade", with an optional asking price (its own currency) and a public
    /// sale note. Drive the collection filter + the public showcase "À vendre"
    /// section; both default false until opted in per item.
    pub for_sale: bool,
    pub for_trade: bool,
    pub asking_price_amount: Option<Decimal>,
    pub asking_price_currency: Option<String>,
    pub sale_note: Option<String>,
    /// Manual sort order within a Vitrines cabinet (drag-and-drop). Null sinks
    /// to the end, ordered by `created_at`.
    pub sort_order: Option<i32>,
    /// FK to the `stores` table. Replaces the old free-text `store` column
    /// (migration 22). Callers send the *name* string in NewOwnedItem /
    /// OwnedPatch; the handler resolves it to an id via
    /// `store::find_or_create`.
    pub store_id: Option<Uuid>,
    pub purchase_date: Option<NaiveDate>,
    pub location: Option<String>,
    pub notes: Option<String>,
    pub cover_photo_id: Option<Uuid>,
    pub cover_scan_id: Option<Uuid>,
    /// Non-null when this item is archived (e.g. preorder cancelled with
    /// a partial / no refund). Hidden from default list views.
    pub archived_at: Option<DateTime<Utc>>,
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
    pub shipping_amount: Option<Decimal>,
    /// Manual valuation (the "cote") + its currency. Null → fall back to MSRP.
    pub value_amount: Option<Decimal>,
    pub value_currency: Option<String>,
    /// Marketplace flags (see `OwnedItem`) — surfaced in the collection filter
    /// and the public showcase "À vendre" section.
    pub for_sale: bool,
    pub for_trade: bool,
    pub asking_price_amount: Option<Decimal>,
    pub asking_price_currency: Option<String>,
    pub sale_note: Option<String>,
    /// Manual sort order within a Vitrines cabinet (drag-and-drop).
    pub sort_order: Option<i32>,
    /// Joined from `stores` — `None` when the user never picked a store or
    /// the store was deleted (FK is ON DELETE SET NULL).
    pub store_id: Option<Uuid>,
    pub store_name: Option<String>,
    pub store_slug: Option<String>,
    pub purchase_date: Option<NaiveDate>,
    pub location: Option<String>,
    pub notes: Option<String>,
    pub archived_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,

    pub figure_name: String,
    pub figure_slug: String,
    pub figure_type: String,
    pub figure_image: Option<String>,
    pub manufacturer_name: Option<String>,
    pub scale: Option<String>,
    pub height_mm: Option<i32>,
    pub version_name: Option<String>,
    /// Catalog MSRP — the fallback "value" shown when the user hasn't set a
    /// manual `value_amount`. Lets the SPA render the cote without a 2nd query.
    pub msrp_amount: Option<Decimal>,
    pub msrp_currency: Option<String>,
    /// Auto-fetched provider/market price (populated by the price cron) + its
    /// currency. Sits between the manual `value_amount` and the MSRP in the
    /// cote fallback chain — lets the SPA render the auto cote without a 2nd query.
    pub provider_price_amount: Option<Decimal>,
    pub provider_price_currency: Option<String>,

    /// Per-user cover preference. Either `cover_photo_id` (a `photos` row),
    /// `cover_scan_id` (a `scans` row), or both null — in the latter case
    /// the SPA falls back to the catalog's primary photo or `figure_image`.
    pub cover_photo_id: Option<Uuid>,
    pub cover_scan_id: Option<Uuid>,
    /// `storage_key` of the pinned cover photo (when `cover_photo_id` is set).
    /// The SPA appends it as `?v=` so the CacheFirst service worker refreshes
    /// the grid thumbnail after an in-place photo edit (same id, new bytes).
    pub cover_photo_key: Option<String>,
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
    pub shipping_amount: Option<Decimal>,
    /// Free-text store name — the handler runs it through
    /// `store::find_or_create` so any user can implicitly add a new
    /// store row by typing its name, and the slug-based lookup collapses
    /// "AmiAmi" / "amiami" / "Ami Ami" onto a single canonical row.
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
    pub shipping_amount: Option<Decimal>,
    pub store: Option<String>,
    pub purchase_date: Option<NaiveDate>,
    pub location: Option<String>,
    pub notes: Option<String>,
    // Marketplace flags. Omitted fields (None) leave the column untouched
    // (COALESCE), so toggling "for sale" never disturbs the price/condition.
    pub for_sale: Option<bool>,
    pub for_trade: Option<bool>,
    pub asking_price_amount: Option<Decimal>,
    pub asking_price_currency: Option<String>,
    pub sale_note: Option<String>,
}

fn default_condition() -> String {
    "mib_sealed".to_string()
}

const ALLOWED_CONDITIONS: &[&str] = &["mib_sealed", "opened_box", "displayed", "loose", "damaged"];

const OWNED_RETURNING: &str =
    "id, user_id, figure_id, condition, price_amount, price_currency, shipping_amount, \
     value_amount, value_currency, \
     for_sale, for_trade, asking_price_amount, asking_price_currency, sale_note, \
     sort_order, \
     store_id, purchase_date, location, notes, cover_photo_id, cover_scan_id, \
     archived_at, created_at, updated_at";

pub async fn create(
    pool: &PgPool,
    user_id: Uuid,
    input: NewOwnedItem,
    price_fx_rate: Option<Decimal>,
) -> AppResult<OwnedItem> {
    if !ALLOWED_CONDITIONS.contains(&input.condition.as_str()) {
        return Err(AppError::BadRequest("invalid condition"));
    }
    if let Some(c) = &input.price_currency {
        if !crate::domain::currency::is_supported(c) {
            return Err(AppError::BadRequest(
                "price_currency must be a supported currency code",
            ));
        }
    }
    if input.notes.as_deref().is_some_and(|n| n.len() > 4096) {
        return Err(AppError::BadRequest("notes too long (max 4096)"));
    }

    // Resolve the free-text store name into a stores.id. If the slug
    // collides with an existing row, we reuse that id; otherwise a fresh
    // store is created (any signed-in user can do this — admin-only
    // metadata fields stay null until an admin curates them).
    let store_id = match input.store.as_deref() {
        Some(name) => super::store::find_or_create(pool, name).await?,
        None => None,
    };

    let id = Uuid::now_v7();
    let sql = format!(
        "INSERT INTO owned_items (
            id, user_id, figure_id, condition, price_amount, price_currency, shipping_amount,
            store_id, purchase_date, location, notes, price_fx_rate
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         RETURNING {OWNED_RETURNING}"
    );

    let item: OwnedItem = sqlx::query_as(&sql)
        .bind(id)
        .bind(user_id)
        .bind(input.figure_id)
        .bind(&input.condition)
        .bind(input.price_amount)
        .bind(&input.price_currency)
        .bind(input.shipping_amount)
        .bind(store_id)
        .bind(input.purchase_date)
        .bind(&input.location)
        .bind(&input.notes)
        .bind(price_fx_rate)
        .fetch_one(pool)
        .await
        .map_err(|e| match e {
            sqlx::Error::Database(ref db) if db.is_foreign_key_violation() => {
                AppError::BadRequest("figure_id does not exist")
            }
            other => AppError::Db(other),
        })?;

    // Owning a figure clears any standing wish for it — you can't wish for
    // what you already have (the "owned ≠ wishlist" rule). Best-effort: the
    // collection insert above already succeeded, so a hiccup clearing the
    // wishlist must never fail the whole add.
    if let Err(e) =
        sqlx::query("DELETE FROM wishlist_items WHERE user_id = $1 AND figure_id = $2")
            .bind(user_id)
            .bind(input.figure_id)
            .execute(pool)
            .await
    {
        tracing::warn!(
            error = ?e, %user_id, figure_id = %input.figure_id,
            "failed to clear wishlist entry after collection add",
        );
    }

    Ok(item)
}

pub async fn patch(
    pool: &PgPool,
    user_id: Uuid,
    id: Uuid,
    input: OwnedPatch,
    price_fx_rate: Option<Decimal>,
) -> AppResult<OwnedItem> {
    if let Some(c) = &input.condition {
        if !ALLOWED_CONDITIONS.contains(&c.as_str()) {
            return Err(AppError::BadRequest("invalid condition"));
        }
    }
    // Same supported-currency floor as create()/set_value(). Without it, a
    // PATCH could store "eur"/"BTC" and split one real currency into bogus
    // per-currency buckets in /api/me/stats (which group by this raw string).
    if let Some(c) = &input.price_currency {
        if !crate::domain::currency::is_supported(c) {
            return Err(AppError::BadRequest(
                "price_currency must be a supported currency code",
            ));
        }
    }
    // Asking-price currency has the same supported-currency floor as the paid
    // price — it's a separate, user-facing amount on the public showcase.
    if let Some(c) = &input.asking_price_currency {
        if !crate::domain::currency::is_supported(c) {
            return Err(AppError::BadRequest(
                "asking_price_currency must be a supported currency code",
            ));
        }
    }

    // Same find-or-create as in `create()`. Patch with `store: ""` is a
    // no-op (find_or_create returns None for empty input, and COALESCE
    // keeps the existing value when the bind is None).
    let store_id = match input.store.as_deref() {
        Some(name) => super::store::find_or_create(pool, name).await?,
        None => None,
    };

    let sql = format!(
        "UPDATE owned_items SET
            condition        = COALESCE($1, condition),
            price_amount     = COALESCE($2, price_amount),
            price_currency   = COALESCE($3, price_currency),
            shipping_amount  = COALESCE($4, shipping_amount),
            store_id         = COALESCE($5, store_id),
            purchase_date    = COALESCE($6, purchase_date),
            location         = COALESCE($7, location),
            notes            = COALESCE($8, notes),
            for_sale              = COALESCE($9, for_sale),
            for_trade             = COALESCE($10, for_trade),
            asking_price_amount   = COALESCE($11, asking_price_amount),
            asking_price_currency = COALESCE($12, asking_price_currency),
            sale_note             = COALESCE($13, sale_note),
            -- Re-freeze the cost→EUR rate only when the currency actually
            -- changes (or was never captured); editing any other field leaves
            -- the purchase-time rate untouched, even if the SPA resends the
            -- unchanged currency in a full-payload patch.
            price_fx_rate    = CASE
                WHEN $3 IS NOT NULL AND ($3 <> price_currency OR price_fx_rate IS NULL)
                    THEN COALESCE($14, price_fx_rate)
                ELSE price_fx_rate
              END
         WHERE id = $15 AND user_id = $16
         RETURNING {OWNED_RETURNING}"
    );

    let row: Option<OwnedItem> = sqlx::query_as(&sql)
        .bind(&input.condition)
        .bind(input.price_amount)
        .bind(&input.price_currency)
        .bind(input.shipping_amount)
        .bind(store_id)
        .bind(input.purchase_date)
        .bind(&input.location)
        .bind(&input.notes)
        .bind(input.for_sale)
        .bind(input.for_trade)
        .bind(input.asking_price_amount)
        .bind(&input.asking_price_currency)
        .bind(&input.sale_note)
        .bind(price_fx_rate)
        .bind(id)
        .bind(user_id)
        .fetch_optional(pool)
        .await?;

    row.ok_or(AppError::NotFound)
}

/// Set or clear the manual current value (the "cote") of an owned item.
/// `amount = None` clears BOTH columns, reverting the displayed value to the
/// catalog-MSRP fallback (so a reset never leaves an orphan currency behind).
/// Unlike `patch`, this writes the columns directly (no COALESCE) precisely so
/// that null can clear.
pub async fn set_value(
    pool: &PgPool,
    user_id: Uuid,
    id: Uuid,
    amount: Option<Decimal>,
    currency: Option<String>,
) -> AppResult<OwnedItem> {
    let (amount, currency) = match amount {
        Some(a) => {
            if let Some(c) = &currency {
                if !crate::domain::currency::is_supported(c) {
                    return Err(AppError::BadRequest(
                        "value_currency must be a supported currency code",
                    ));
                }
            }
            (Some(a), currency)
        }
        // Clearing the value also drops its currency.
        None => (None, None),
    };

    let sql = format!(
        "UPDATE owned_items SET value_amount = $1, value_currency = $2
         WHERE id = $3 AND user_id = $4
         RETURNING {OWNED_RETURNING}"
    );
    let row: Option<OwnedItem> = sqlx::query_as(&sql)
        .bind(amount)
        .bind(&currency)
        .bind(id)
        .bind(user_id)
        .fetch_optional(pool)
        .await?;
    row.ok_or(AppError::NotFound)
}

/// Re-home and re-order a whole cabinet's contents in one statement: every id
/// in `ordered_ids` gets a sequential `sort_order` matching its position, and
/// optionally a new `location`. Items not listed are left untouched. Powers
/// the Vitrines drag-and-drop (within-shelf reorder + cross-shelf move).
///
/// `location` semantics (three states, via COALESCE):
/// - `None`        → reorder only, leave each item's existing shelf untouched.
/// - `Some("")`    → move to the unshelved group (empty string is NOT NULL in
///                   SQL, so COALESCE returns it and the column is set to '').
/// - `Some(name)`  → move to that named cabinet.
pub async fn arrange(
    pool: &PgPool,
    user_id: Uuid,
    location: Option<&str>,
    ordered_ids: &[Uuid],
) -> AppResult<()> {
    if ordered_ids.is_empty() {
        return Ok(());
    }
    sqlx::query(
        "UPDATE owned_items o
         SET location = COALESCE($2, location), sort_order = data.ord
         FROM (
             SELECT id, ord::int AS ord
             FROM unnest($3::uuid[]) WITH ORDINALITY AS t(id, ord)
         ) data
         WHERE o.id = data.id AND o.user_id = $1",
    )
    .bind(user_id)
    .bind(location)
    .bind(ordered_ids)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn list_for_user(
    pool: &PgPool,
    user_id: Uuid,
    exclude_nsfw: bool,
    include_archived: bool,
) -> AppResult<Vec<OwnedItemWithFigure>> {
    // `catalog_cover_photo_id` is resolved here so the SPA can build the
    // fallback `/api/figure-photos/{id}` URL without a second roundtrip per
    // row. `is_primary DESC` puts the primary first when one exists, then
    // falls back to position order.
    let mut sql = String::from(
        "SELECT
            o.id, o.figure_id, o.condition, o.price_amount, o.price_currency,
            o.shipping_amount,
            o.value_amount, o.value_currency,
            o.for_sale, o.for_trade, o.asking_price_amount, o.asking_price_currency, o.sale_note,
            o.sort_order,
            o.store_id,
            st.name AS store_name,
            st.slug AS store_slug,
            o.purchase_date, o.location, o.notes,
            o.archived_at, o.created_at,
            f.name AS figure_name, f.slug AS figure_slug, f.figure_type,
            f.official_image_url AS figure_image,
            m.name AS manufacturer_name,
            f.scale, f.height_mm, f.version_name,
            f.msrp_amount, f.msrp_currency,
            pp.amount   AS provider_price_amount,
            pp.currency AS provider_price_currency,
            o.cover_photo_id, o.cover_scan_id,
            (SELECT ph.storage_key FROM photos ph WHERE ph.id = o.cover_photo_id) AS cover_photo_key,
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
         LEFT JOIN figure_provider_prices pp ON pp.figure_id = o.figure_id
         LEFT JOIN manufacturers m ON m.id = f.manufacturer_id
         LEFT JOIN stores st       ON st.id = o.store_id
         LEFT JOIN preorders p   ON p.owned_item_id = o.id
         WHERE o.user_id = $1",
    );
    if exclude_nsfw {
        sql.push_str(" AND NOT f.is_nsfw");
    }
    if !include_archived {
        sql.push_str(" AND o.archived_at IS NULL");
    }
    // Archived items, when included, sink to the bottom of the list so they
    // don't crowd the "active collection" experience.
    sql.push_str(" ORDER BY (o.archived_at IS NOT NULL) ASC, o.created_at DESC");
    Ok(sqlx::query_as::<_, OwnedItemWithFigure>(&sql)
        .bind(user_id)
        .fetch_all(pool)
        .await?)
}

/// Mark an owned item as archived (preorder cancelled with partial refund).
/// Idempotent — re-archiving an already-archived item is a no-op but still
/// returns the row.
pub async fn archive(pool: &PgPool, user_id: Uuid, id: Uuid) -> AppResult<OwnedItem> {
    let sql = format!(
        "UPDATE owned_items
         SET archived_at = COALESCE(archived_at, NOW())
         WHERE id = $1 AND user_id = $2
         RETURNING {OWNED_RETURNING}"
    );
    let row: Option<OwnedItem> = sqlx::query_as(&sql)
        .bind(id)
        .bind(user_id)
        .fetch_optional(pool)
        .await?;
    row.ok_or(AppError::NotFound)
}

/// Restore an archived owned item back into the active collection. Clears
/// `archived_at`. The linked preorder (if any) keeps whatever status it had
/// — the user typically wants to set it back to "preordered" via the normal
/// edit flow.
pub async fn restore(pool: &PgPool, user_id: Uuid, id: Uuid) -> AppResult<OwnedItem> {
    let sql = format!(
        "UPDATE owned_items
         SET archived_at = NULL
         WHERE id = $1 AND user_id = $2
         RETURNING {OWNED_RETURNING}"
    );
    let row: Option<OwnedItem> = sqlx::query_as(&sql)
        .bind(id)
        .bind(user_id)
        .fetch_optional(pool)
        .await?;
    row.ok_or(AppError::NotFound)
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

/// Storage keys orphaned when an owned item is deleted. The photo/scan ROWS
/// cascade away with the item (ON DELETE CASCADE), taking their keys with
/// them — so the caller must purge the Garage blobs from this snapshot.
pub struct OrphanedBlobs {
    /// `photos.storage_key` values (single objects).
    pub photo_keys: Vec<String>,
    /// `(scans.storage_prefix, scans.result_key)` — prefixes hold the frame
    /// set + source video; the caller fans these out via `purge_scan_blobs`.
    pub scan_blobs: Vec<(String, Option<String>)>,
}

pub async fn delete_for_user(
    pool: &PgPool,
    user_id: Uuid,
    id: Uuid,
) -> AppResult<OrphanedBlobs> {
    // Snapshot the blob keys BEFORE the delete — the photo/scan rows vanish via
    // ON DELETE CASCADE the moment the owned item goes, so their storage_keys
    // are unreadable afterwards. Both selects are scoped through
    // owned_items.user_id, so we never read another user's keys (and they
    // return empty for an item that isn't this user's → nothing purged).
    let photo_keys: Vec<String> = sqlx::query_scalar(
        "SELECT p.storage_key FROM photos p
         JOIN owned_items o ON o.id = p.owned_item_id
         WHERE o.id = $1 AND o.user_id = $2",
    )
    .bind(id)
    .bind(user_id)
    .fetch_all(pool)
    .await?;
    let scan_blobs: Vec<(String, Option<String>)> = sqlx::query_as(
        "SELECT s.storage_prefix, s.result_key FROM scans s
         JOIN owned_items o ON o.id = s.owned_item_id
         WHERE o.id = $1 AND o.user_id = $2",
    )
    .bind(id)
    .bind(user_id)
    .fetch_all(pool)
    .await?;

    let result = sqlx::query("DELETE FROM owned_items WHERE id = $1 AND user_id = $2")
        .bind(id)
        .bind(user_id)
        .execute(pool)
        .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    Ok(OrphanedBlobs {
        photo_keys,
        scan_blobs,
    })
}

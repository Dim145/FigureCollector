//! Stores — promoted from a free-text column to a first-class entity in
//! migration 22.
//!
//! Lookup rule (key for the auto-create flow): we identify a store by its
//! **slug**, never by its name. When a non-admin user types "AmiAmi" in
//! the store field of an owned_item or preorder:
//!
//!   1. Server slugifies the input ("AmiAmi" → "amiami").
//!   2. Lookup `stores WHERE slug = 'amiami'`.
//!   3. Match → reuse that row's id (regardless of name spelling).
//!   4. No match → create a new row (name as typed, slug derived).
//!
//! That way "AmiAmi", "amiami", and "Ami Ami" all collapse onto the same
//! canonical row, and only the admin's curated name (set via the admin
//! CRUD) is shown in the UI.

use crate::error::{AppError, AppResult};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, PgPool};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct Store {
    pub id: Uuid,
    pub name: String,
    pub slug: String,
    pub url: Option<String>,
    pub image_storage_key: Option<String>,
    pub description: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct NewStore {
    pub name: String,
    pub url: Option<String>,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct StorePatch {
    pub name: Option<String>,
    pub url: Option<String>,
    pub description: Option<String>,
}

/// Sluggify the way migration 22 does (Rust-side mirror of the SQL helper).
/// Ascii-lowercase, collapse non-alphanumeric runs into "-", trim, fall
/// back to "store" on empty input.
pub fn slugify(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut prev_dash = false;
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
        "store".into()
    } else {
        out.chars().take(80).collect()
    }
}

pub async fn list(pool: &PgPool) -> AppResult<Vec<Store>> {
    Ok(sqlx::query_as::<_, Store>(
        "SELECT id, name, slug, url, image_storage_key, description,
                created_at, updated_at
         FROM stores
         ORDER BY lower(name) ASC",
    )
    .fetch_all(pool)
    .await?)
}

pub async fn get_by_slug(pool: &PgPool, slug: &str) -> AppResult<Store> {
    let row: Option<Store> = sqlx::query_as(
        "SELECT id, name, slug, url, image_storage_key, description,
                created_at, updated_at
         FROM stores WHERE slug = $1",
    )
    .bind(slug)
    .fetch_optional(pool)
    .await?;
    row.ok_or(AppError::NotFound)
}

pub async fn get_by_id(pool: &PgPool, id: Uuid) -> AppResult<Store> {
    let row: Option<Store> = sqlx::query_as(
        "SELECT id, name, slug, url, image_storage_key, description,
                created_at, updated_at
         FROM stores WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?;
    row.ok_or(AppError::NotFound)
}

/// Find by slug (derived from the typed name) or create a fresh row.
/// Returns the store's id either way.
///
/// This is the function the owned_items / preorders create+patch handlers
/// call when they receive a `store` *name* string instead of a `store_id`.
/// Trimming + empty-check happens here so callers don't have to repeat it.
pub async fn find_or_create(pool: &PgPool, name: &str) -> AppResult<Option<Uuid>> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    let slug = slugify(trimmed);

    // First try the cheap lookup — covers the 99% case where the slug
    // already exists.
    if let Some((id,)) = sqlx::query_as::<_, (Uuid,)>("SELECT id FROM stores WHERE slug = $1")
        .bind(&slug)
        .fetch_optional(pool)
        .await?
    {
        return Ok(Some(id));
    }

    // Race-safe insert — another request could land between the lookup
    // above and the insert below. ON CONFLICT (slug) DO UPDATE returns
    // the existing row's id when a sibling already won the race.
    let id = Uuid::now_v7();
    let row: (Uuid,) = sqlx::query_as(
        "INSERT INTO stores (id, name, slug) VALUES ($1, $2, $3)
         ON CONFLICT (slug) DO UPDATE SET slug = EXCLUDED.slug
         RETURNING id",
    )
    .bind(id)
    .bind(trimmed)
    .bind(&slug)
    .fetch_one(pool)
    .await?;
    Ok(Some(row.0))
}

pub async fn create(pool: &PgPool, input: NewStore) -> AppResult<Store> {
    let name = input.name.trim();
    if name.is_empty() {
        return Err(AppError::BadRequest("store name is required"));
    }
    if name.len() > 128 {
        return Err(AppError::BadRequest("store name too long (max 128)"));
    }
    let slug = slugify(name);
    let id = Uuid::now_v7();

    sqlx::query_as::<_, Store>(
        "INSERT INTO stores (id, name, slug, url, description)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, name, slug, url, image_storage_key, description,
                   created_at, updated_at",
    )
    .bind(id)
    .bind(name)
    .bind(&slug)
    .bind(input.url.as_deref().map(str::trim).filter(|s| !s.is_empty()))
    .bind(input.description.as_deref().map(str::trim).filter(|s| !s.is_empty()))
    .fetch_one(pool)
    .await
    .map_err(|e| match e {
        sqlx::Error::Database(ref db) if db.is_unique_violation() => {
            AppError::BadRequest("a store with that slug already exists")
        }
        other => AppError::Db(other),
    })
}

pub async fn patch(pool: &PgPool, id: Uuid, input: StorePatch) -> AppResult<Store> {
    // The slug follows the name. Re-slugify on a rename so two stores
    // never collide invisibly.
    let new_slug = input.name.as_deref().map(|n| slugify(n.trim()));

    let row: Option<Store> = sqlx::query_as(
        "UPDATE stores SET
            name        = COALESCE($1, name),
            slug        = COALESCE($2, slug),
            url         = COALESCE($3, url),
            description = COALESCE($4, description)
         WHERE id = $5
         RETURNING id, name, slug, url, image_storage_key, description,
                   created_at, updated_at",
    )
    .bind(input.name.as_deref().map(str::trim).filter(|s| !s.is_empty()))
    .bind(new_slug)
    .bind(input.url.as_deref().map(str::trim))
    .bind(input.description.as_deref().map(str::trim))
    .bind(id)
    .fetch_optional(pool)
    .await
    .map_err(|e| match e {
        sqlx::Error::Database(ref db) if db.is_unique_violation() => {
            AppError::BadRequest("the new name produces a slug that's already taken")
        }
        other => AppError::Db(other),
    })?;
    row.ok_or(AppError::NotFound)
}

pub async fn set_image_key(pool: &PgPool, id: Uuid, key: &str) -> AppResult<Store> {
    let row: Option<Store> = sqlx::query_as(
        "UPDATE stores SET image_storage_key = $1 WHERE id = $2
         RETURNING id, name, slug, url, image_storage_key, description,
                   created_at, updated_at",
    )
    .bind(key)
    .bind(id)
    .fetch_optional(pool)
    .await?;
    row.ok_or(AppError::NotFound)
}

pub async fn delete(pool: &PgPool, id: Uuid) -> AppResult<()> {
    // FK on owned_items.store_id + preorders.store_id is ON DELETE SET
    // NULL, so the user-side records are preserved; only the store
    // metadata disappears.
    let res = sqlx::query("DELETE FROM stores WHERE id = $1")
        .bind(id)
        .execute(pool)
        .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    Ok(())
}

/// How many owned_items + preorders currently link to this store. Used
/// by the admin UI to show "12 owned items, 3 preorders use this store"
/// next to the delete button.
#[derive(Debug, Serialize)]
pub struct StoreUsage {
    pub owned_items: i64,
    pub preorders: i64,
}

pub async fn usage(pool: &PgPool, id: Uuid) -> AppResult<StoreUsage> {
    let owned: (i64,) =
        sqlx::query_as("SELECT COUNT(*)::bigint FROM owned_items WHERE store_id = $1")
            .bind(id)
            .fetch_one(pool)
            .await?;
    let pre: (i64,) =
        sqlx::query_as("SELECT COUNT(*)::bigint FROM preorders WHERE store_id = $1")
            .bind(id)
            .fetch_one(pool)
            .await?;
    Ok(StoreUsage {
        owned_items: owned.0,
        preorders: pre.0,
    })
}

/// Distinct figures (catalog rows) that at least one user has linked to
/// this store via an owned_item OR a preorder. This is the catalogue
/// shown beneath the store profile on `/stores/<slug>` — the operator
/// asked for "le catalogue des figurines de cette boutique" without
/// per-user privacy concerns, so we return the figure list ungrouped.
#[derive(Debug, Serialize, FromRow)]
pub struct StoreCatalogFigure {
    pub id: Uuid,
    pub name: String,
    pub slug: String,
    pub figure_type: String,
    pub manufacturer_name: Option<String>,
    pub manufacturer_slug: Option<String>,
    pub release_date: Option<chrono::NaiveDate>,
    pub msrp_amount: Option<rust_decimal::Decimal>,
    pub msrp_currency: Option<String>,
    pub is_nsfw: bool,
    pub primary_photo_id: Option<Uuid>,
}

pub async fn catalog(
    pool: &PgPool,
    store_id: Uuid,
    exclude_nsfw: bool,
) -> AppResult<Vec<StoreCatalogFigure>> {
    // figure_stores is now the source of truth — owned/preorders are still
    // synced into it via the migration-22 triggers, plus admins can add
    // links manually. Querying the join table directly keeps the SQL
    // simple and consistent with the manual additions.
    let mut sql = String::from(
        "SELECT
            f.id, f.name, f.slug, f.figure_type,
            m.name AS manufacturer_name, m.slug AS manufacturer_slug,
            f.release_date, f.msrp_amount, f.msrp_currency, f.is_nsfw,
            (
                SELECT fp.id FROM figure_photos fp
                WHERE fp.figure_id = f.id
                ORDER BY fp.is_primary DESC, fp.position ASC, fp.created_at ASC
                LIMIT 1
            ) AS primary_photo_id
         FROM figures f
         JOIN figure_stores fs ON fs.figure_id = f.id
         LEFT JOIN manufacturers m ON m.id = f.manufacturer_id
         WHERE fs.store_id = $1",
    );
    if exclude_nsfw {
        sql.push_str(" AND NOT f.is_nsfw");
    }
    sql.push_str(" ORDER BY f.release_date DESC NULLS LAST, lower(f.name) ASC");

    Ok(sqlx::query_as::<_, StoreCatalogFigure>(&sql)
        .bind(store_id)
        .fetch_all(pool)
        .await?)
}

// =============================================================================
// figure_stores — M2M link helpers
// =============================================================================

/// Lightweight store row used in the figure-detail "stores popup" and in
/// the FigureForm admin section. Smaller than the full Store and skips
/// description / image / timestamps.
#[derive(Debug, Serialize, FromRow)]
pub struct LinkedStore {
    pub id: Uuid,
    pub name: String,
    pub slug: String,
    pub url: Option<String>,
    pub image_storage_key: Option<String>,
}

/// Stores currently linked to a given figure. Used by the public "Boutiques"
/// button on /figures/:id (any signed-in user can see this list) and by
/// the FigureForm admin section.
pub async fn stores_for_figure(pool: &PgPool, figure_id: Uuid) -> AppResult<Vec<LinkedStore>> {
    Ok(sqlx::query_as::<_, LinkedStore>(
        "SELECT s.id, s.name, s.slug, s.url, s.image_storage_key \
         FROM stores s \
         JOIN figure_stores fs ON fs.store_id = s.id \
         WHERE fs.figure_id = $1 \
         ORDER BY lower(s.name) ASC",
    )
    .bind(figure_id)
    .fetch_all(pool)
    .await?)
}

/// Manual admin add. Idempotent — `ON CONFLICT DO NOTHING` so re-adding
/// an already-linked pair is a no-op and won't fail.
pub async fn link_figure(pool: &PgPool, store_id: Uuid, figure_id: Uuid) -> AppResult<()> {
    sqlx::query(
        "INSERT INTO figure_stores (figure_id, store_id) VALUES ($1, $2) \
         ON CONFLICT DO NOTHING",
    )
    .bind(figure_id)
    .bind(store_id)
    .execute(pool)
    .await?;
    Ok(())
}

/// Manual admin remove. The trigger on owned_items / preorders will
/// re-link the same pair on the next write, which matches the
/// documented behaviour ("trigger re-creates it" path).
pub async fn unlink_figure(pool: &PgPool, store_id: Uuid, figure_id: Uuid) -> AppResult<()> {
    sqlx::query("DELETE FROM figure_stores WHERE store_id = $1 AND figure_id = $2")
        .bind(store_id)
        .bind(figure_id)
        .execute(pool)
        .await?;
    Ok(())
}

/// Bulk set — replace the full list of figures linked to a store. The
/// frontend's checkbox grid sends every catalog figure's id along with
/// its current toggle state; the diff happens here in one transaction.
pub async fn set_store_figures(
    pool: &PgPool,
    store_id: Uuid,
    figure_ids: &[Uuid],
) -> AppResult<()> {
    let mut tx = pool.begin().await?;
    sqlx::query("DELETE FROM figure_stores WHERE store_id = $1")
        .bind(store_id)
        .execute(&mut *tx)
        .await?;
    if !figure_ids.is_empty() {
        sqlx::query(
            "INSERT INTO figure_stores (figure_id, store_id) \
             SELECT unnest($1::uuid[]), $2 \
             ON CONFLICT DO NOTHING",
        )
        .bind(figure_ids)
        .bind(store_id)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    Ok(())
}

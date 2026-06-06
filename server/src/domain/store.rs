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

// =============================================================================
// URL helpers — shared by the figure-import auto-link (figure::create) and the
// admin "buy link" curation. A store holds the scheme+host on `stores.url`;
// the per-figure product link on `figure_stores.link` holds only the path +
// query. These three functions are the single place that splits a full URL
// into those two halves (and tolerates a scheme-less paste like "orzgk.com/…").
// =============================================================================

/// Parse a possibly-scheme-less URL string. Returns None on empty / garbage.
fn parse_lenient(raw: &str) -> Option<url::Url> {
    let t = raw.trim();
    if t.is_empty() {
        return None;
    }
    if t.contains("://") {
        url::Url::parse(t).ok()
    } else {
        url::Url::parse(&format!("https://{t}")).ok()
    }
}

/// Lowercased host of a URL, sans a leading `www.`. None when there's no host.
pub fn host_of(raw: &str) -> Option<String> {
    let u = parse_lenient(raw)?;
    let host = u.host_str()?.to_lowercase();
    Some(host.trim_start_matches("www.").to_string())
}

/// `scheme://host[:port]` of a URL — no path/query/fragment. Used to seed an
/// auto-created store's base `url` from the product URL it was imported from.
pub fn origin_of(raw: &str) -> Option<String> {
    let u = parse_lenient(raw)?;
    let host = u.host_str()?;
    let scheme = u.scheme();
    Some(match u.port() {
        Some(p) => format!("{scheme}://{host}:{p}"),
        None => format!("{scheme}://{host}"),
    })
}

/// The path + query of a product URL — everything the store's base `url`
/// doesn't already carry, fragment dropped. Accepts a full URL OR a bare
/// `/path?query` (what an admin might paste directly). Returns None for empty
/// or root-only ("/") links, where there's nothing worth storing.
pub fn path_and_query(raw: &str) -> Option<String> {
    let t = raw.trim();
    if t.is_empty() {
        return None;
    }
    // Already a bare path (single leading slash, not protocol-relative "//").
    if t.starts_with('/') && !t.starts_with("//") {
        let no_frag = t.split('#').next().unwrap_or(t);
        return nonempty_pq(no_frag);
    }
    let u = parse_lenient(t)?;
    if u.scheme() != "http" && u.scheme() != "https" {
        return None;
    }
    let mut pq = u.path().to_string();
    if let Some(q) = u.query() {
        pq.push('?');
        pq.push_str(q);
    }
    nonempty_pq(&pq)
}

fn nonempty_pq(pq: &str) -> Option<String> {
    if pq.is_empty() || pq == "/" {
        None
    } else {
        Some(pq.to_string())
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
    /// Buy link (path + query) for this figure at THIS store, if known — lets
    /// the storefront catalogue show a per-figure "Acheter" shortcut.
    pub link: Option<String>,
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
            fs.link,
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
    /// Path + query of this figure's product page at this store (the buy
    /// link). NULL when the pair is linked but no product URL is known.
    /// Full buy URL = origin(`url`) + `link`, reassembled on the SPA.
    pub link: Option<String>,
}

/// Stores currently linked to a given figure. Used by the public "Boutiques"
/// button on /figures/:id (any signed-in user can see this list) and by
/// the FigureForm admin section.
pub async fn stores_for_figure(pool: &PgPool, figure_id: Uuid) -> AppResult<Vec<LinkedStore>> {
    Ok(sqlx::query_as::<_, LinkedStore>(
        "SELECT s.id, s.name, s.slug, s.url, s.image_storage_key, fs.link \
         FROM stores s \
         JOIN figure_stores fs ON fs.store_id = s.id \
         WHERE fs.figure_id = $1 \
         ORDER BY lower(s.name) ASC",
    )
    .bind(figure_id)
    .fetch_all(pool)
    .await?)
}

/// Manual admin add / link-edit. Upserts the (figure, store) pair and sets its
/// buy `link`. `link_input` may be a full product URL or a bare `/path?query`
/// — either way only the path+query is kept (the host lives on `stores.url`).
/// `None` (or an empty/root-only string) clears the link while keeping the
/// pair linked. Editing an existing link goes through this same path with the
/// new value.
pub async fn link_figure(
    pool: &PgPool,
    store_id: Uuid,
    figure_id: Uuid,
    link_input: Option<&str>,
) -> AppResult<()> {
    let link = link_input.and_then(path_and_query);
    sqlx::query(
        "INSERT INTO figure_stores (figure_id, store_id, link) VALUES ($1, $2, $3) \
         ON CONFLICT (figure_id, store_id) DO UPDATE SET link = EXCLUDED.link",
    )
    .bind(figure_id)
    .bind(store_id)
    .bind(link)
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

/// Bulk set — reconcile the full list of figures linked to a store. The
/// frontend's checkbox grid sends every catalog figure's id along with
/// its current toggle state; the diff happens here in one transaction.
///
/// Implemented as a diff (remove the de-selected, add the new) rather than a
/// delete-all+reinsert so that the per-figure buy `link` on figures that stay
/// linked survives a bulk edit — a wholesale wipe would silently drop every
/// curated link the next time an admin touched the store's catalogue.
pub async fn set_store_figures(
    pool: &PgPool,
    store_id: Uuid,
    figure_ids: &[Uuid],
) -> AppResult<()> {
    let mut tx = pool.begin().await?;
    // Remove links that are no longer selected. With an empty selection this
    // deletes them all (NOT (x = ANY('{}')) is true for every row).
    sqlx::query("DELETE FROM figure_stores WHERE store_id = $1 AND NOT (figure_id = ANY($2))")
        .bind(store_id)
        .bind(figure_ids)
        .execute(&mut *tx)
        .await?;
    if !figure_ids.is_empty() {
        // Add newly-selected pairs; ON CONFLICT DO NOTHING leaves the existing
        // rows (and their `link`) untouched.
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn host_of_strips_scheme_and_www() {
        assert_eq!(host_of("https://orzgk.com/item/1").as_deref(), Some("orzgk.com"));
        assert_eq!(host_of("https://www.AmiAmi.com/").as_deref(), Some("amiami.com"));
        // Scheme-less paste — tolerated.
        assert_eq!(host_of("orzgk.com/item/1").as_deref(), Some("orzgk.com"));
        assert_eq!(host_of(""), None);
        assert_eq!(host_of("not a url"), None);
    }

    #[test]
    fn origin_of_keeps_scheme_host_port_only() {
        // www is part of the real origin and is preserved (host_of strips it
        // only for matching/display); the store's base url should be exact.
        assert_eq!(
            origin_of("https://www.amiami.com/eng/detail?gcode=X").as_deref(),
            Some("https://www.amiami.com")
        );
        assert_eq!(
            origin_of("http://shop.com:8080/p").as_deref(),
            Some("http://shop.com:8080")
        );
        // Scheme defaulted to https on a bare host.
        assert_eq!(origin_of("orzgk.com/x").as_deref(), Some("https://orzgk.com"));
    }

    #[test]
    fn path_and_query_extracts_relative_part() {
        assert_eq!(
            path_and_query("https://orzgk.com/products/abc?ref=x#frag").as_deref(),
            Some("/products/abc?ref=x") // fragment dropped
        );
        // A bare path (what an admin might paste directly) is kept as-is.
        assert_eq!(path_and_query("/item/123?x=1").as_deref(), Some("/item/123?x=1"));
        // Scheme-less full URL still splits.
        assert_eq!(path_and_query("orzgk.com/p/9").as_deref(), Some("/p/9"));
    }

    #[test]
    fn path_and_query_rejects_empty_root_and_bad_scheme() {
        assert_eq!(path_and_query(""), None);
        assert_eq!(path_and_query("/"), None);
        assert_eq!(path_and_query("https://shop.com"), None); // root only — nothing to store
        assert_eq!(path_and_query("https://shop.com/"), None);
        assert_eq!(path_and_query("ftp://x/y"), None); // non-http(s)
        assert_eq!(path_and_query("javascript:alert(1)"), None);
    }
}

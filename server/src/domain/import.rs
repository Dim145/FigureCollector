//! Backup import / restore — the missing half of [`crate::domain::export`].
//!
//! `GET /me/export/backup.json` has always claimed to "round-trip cleanly for
//! re-import", but no import route existed: the only way into a fresh instance
//! was typing 300 figures by hand. This module closes that loop, and doubles as
//! the arrival path for people coming from a spreadsheet or another tracker.
//!
//! **Wire format = the export format.** We deserialize the very same row
//! structs the exporter serializes, so the two can never drift apart.
//!
//! **Safety rules**
//!   - Everything is scoped to the *session* `user_id`. A backup file names a
//!     user, but that name is ignored: a file can never write into someone
//!     else's collection.
//!   - Dry-run first. [`preview`] reports exactly what would happen — how many
//!     rows match an existing catalogue figure, how many would create one, how
//!     many are already on your shelf — and touches nothing.
//!   - One transaction per apply: a failure half-way leaves the collection
//!     exactly as it was, never half-restored.
//!   - Catalogue writes are opt-in (`create_missing`). The catalogue is shared,
//!     so silently seeding it from a stranger's spreadsheet is not a default.

use crate::domain::export::{CollectionRow, WishlistRow};
use crate::domain::store::slugify;
use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Postgres, Row, Transaction};
use uuid::Uuid;

/// Hard cap on rows accepted in one file — a guard against a malformed or
/// hostile upload, well above any real collection.
const MAX_ROWS: usize = 20_000;

/// What to do when a piece in the file is already on the shelf.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum MergePolicy {
    /// Leave the existing row untouched (default — an import should never
    /// quietly rewrite data you already curated).
    #[default]
    Skip,
    /// Add it anyway: owning two of the same figure is legitimate.
    Duplicate,
}

/// A parsed backup file. Unknown sections are ignored so a newer export can
/// still be read by an older instance.
#[derive(Debug, Default, Deserialize)]
#[serde(default)]
pub struct BackupFile {
    pub collection: Vec<CollectionRow>,
    pub wishlist: Vec<WishlistRow>,
}

#[derive(Debug, Default, Serialize)]
pub struct ImportPlan {
    /// Rows read from the file.
    pub collection_rows: usize,
    pub wishlist_rows: usize,
    /// Rows whose figure already exists in the catalogue.
    pub matched_figures: usize,
    /// Rows that would need a new catalogue figure created.
    pub new_figures: usize,
    /// Rows already present on the user's shelf / wishlist.
    pub already_present: usize,
    /// Rows that cannot be imported (no usable name), with a reason each.
    pub skipped: Vec<String>,
}

#[derive(Debug, Default, Serialize)]
pub struct ImportResult {
    pub collection_added: usize,
    pub wishlist_added: usize,
    pub figures_created: usize,
    pub skipped: Vec<String>,
}

/// Resolve a file row to a catalogue figure id, without creating anything.
/// JAN first (a barcode is an identity), then an exact case-insensitive
/// name + manufacturer match. Name alone is deliberately NOT enough across
/// makers — "Miku" exists a hundred times.
async fn find_figure(
    tx: &mut Transaction<'_, Postgres>,
    name: &str,
    manufacturer: Option<&str>,
    jan: Option<&str>,
) -> AppResult<Option<Uuid>> {
    if let Some(jan) = jan.map(str::trim).filter(|s| !s.is_empty()) {
        let hit: Option<(Uuid,)> = sqlx::query_as("SELECT id FROM figures WHERE jan = $1 LIMIT 1")
            .bind(jan)
            .fetch_optional(&mut **tx)
            .await?;
        if let Some((id,)) = hit {
            return Ok(Some(id));
        }
    }
    let hit: Option<(Uuid,)> = sqlx::query_as(
        "SELECT f.id FROM figures f
         LEFT JOIN manufacturers m ON m.id = f.manufacturer_id
         WHERE lower(f.name) = lower($1)
           AND ($2::text IS NULL OR lower(coalesce(m.name, '')) = lower($2))
         LIMIT 1",
    )
    .bind(name)
    .bind(manufacturer)
    .fetch_optional(&mut **tx)
    .await?;
    Ok(hit.map(|(id,)| id))
}

/// Resolve a figure type from the file against the instance's `figure_types`
/// table, which `figures.figure_type` references by foreign key.
///
/// A backup can name a type this instance doesn't have (an older export, a
/// different deployment, a hand-written spreadsheet), and a bare INSERT then
/// dies on the FK and takes the whole import with it. Fall back to `other` —
/// the column's own default — so one unrecognised label costs a category, not
/// the restore.
async fn resolve_figure_type(tx: &mut Transaction<'_, Postgres>, requested: &str) -> AppResult<String> {
    let want = requested.trim().to_lowercase();
    if !want.is_empty() {
        let hit: Option<(String,)> = sqlx::query_as("SELECT id FROM figure_types WHERE id = $1")
            .bind(&want)
            .fetch_optional(&mut **tx)
            .await?;
        if let Some((id,)) = hit {
            return Ok(id);
        }
    }
    Ok("other".to_string())
}

/// Create the minimum viable catalogue figure for an imported row. Marked
/// `is_user_submitted` like any other non-admin contribution, so catalogue
/// hygiene tooling can review it later.
async fn create_figure(
    tx: &mut Transaction<'_, Postgres>,
    user_id: Uuid,
    name: &str,
    figure_type: &str,
    manufacturer: Option<&str>,
    scale: Option<&str>,
    jan: Option<&str>,
) -> AppResult<Uuid> {
    let manufacturer_id: Option<Uuid> = match manufacturer.map(str::trim).filter(|s| !s.is_empty())
    {
        Some(n) => {
            let row = sqlx::query(
                "INSERT INTO manufacturers (name, slug) VALUES ($1, $2)
                 ON CONFLICT (slug) DO UPDATE SET name = manufacturers.name
                 RETURNING id",
            )
            .bind(n)
            .bind(slugify(n))
            .fetch_one(&mut **tx)
            .await?;
            Some(row.get(0))
        }
        None => None,
    };

    // Slug collisions are real (two makers, one character name), so suffix with
    // a short id fragment rather than failing the whole import on a unique
    // violation.
    let figure_type = resolve_figure_type(tx, figure_type).await?;

    let id = Uuid::new_v4();
    let slug = format!("{}-{}", slugify(name), &id.to_string()[..8]);
    let row = sqlx::query(
        "INSERT INTO figures (id, name, slug, manufacturer_id, figure_type, scale, jan,
                              created_by, is_user_submitted)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, TRUE)
         RETURNING id",
    )
    .bind(id)
    .bind(name)
    .bind(&slug)
    .bind(manufacturer_id)
    .bind(&figure_type)
    .bind(scale)
    .bind(jan.map(str::trim).filter(|s| !s.is_empty()))
    .bind(user_id)
    .fetch_one(&mut **tx)
    .await?;
    Ok(row.get(0))
}

fn check_size(file: &BackupFile) -> AppResult<()> {
    if file.collection.len() + file.wishlist.len() > MAX_ROWS {
        return Err(AppError::BadRequest("backup file has too many rows"));
    }
    Ok(())
}

/// Dry run: report what an apply would do, writing nothing. Runs inside a
/// transaction that is always rolled back, so the "would create" counts are
/// computed against the same snapshot an apply would see.
pub async fn preview(pool: &PgPool, user_id: Uuid, file: &BackupFile) -> AppResult<ImportPlan> {
    check_size(file)?;
    let mut tx = pool.begin().await?;
    let mut plan = ImportPlan {
        collection_rows: file.collection.len(),
        wishlist_rows: file.wishlist.len(),
        ..Default::default()
    };

    // Figures the file would create are counted once, not once per row.
    let mut would_create: std::collections::HashSet<String> = std::collections::HashSet::new();

    for row in &file.collection {
        let name = row.figure_name.trim();
        if name.is_empty() {
            plan.skipped.push("collection row without a figure name".into());
            continue;
        }
        match find_figure(&mut tx, name, row.manufacturer.as_deref(), row.jan.as_deref()).await? {
            Some(fid) => {
                plan.matched_figures += 1;
                let owned: Option<(i64,)> = sqlx::query_as(
                    "SELECT count(*) FROM owned_items
                     WHERE user_id = $1 AND figure_id = $2 AND archived_at IS NULL",
                )
                .bind(user_id)
                .bind(fid)
                .fetch_optional(&mut *tx)
                .await?;
                if owned.map(|c| c.0).unwrap_or(0) > 0 {
                    plan.already_present += 1;
                }
            }
            None => {
                would_create.insert(format!(
                    "{}|{}",
                    name.to_lowercase(),
                    row.manufacturer.as_deref().unwrap_or("").to_lowercase()
                ));
            }
        }
    }
    for row in &file.wishlist {
        let name = row.figure_name.trim();
        if name.is_empty() {
            plan.skipped.push("wishlist row without a figure name".into());
            continue;
        }
        match find_figure(&mut tx, name, row.manufacturer.as_deref(), None).await? {
            Some(_) => plan.matched_figures += 1,
            None => {
                would_create.insert(format!(
                    "{}|{}",
                    name.to_lowercase(),
                    row.manufacturer.as_deref().unwrap_or("").to_lowercase()
                ));
            }
        }
    }
    plan.new_figures = would_create.len();
    // Never commit a preview.
    tx.rollback().await?;
    Ok(plan)
}

/// Apply the file. One transaction: either the whole restore lands or none of
/// it does.
pub async fn apply(
    pool: &PgPool,
    user_id: Uuid,
    file: &BackupFile,
    policy: MergePolicy,
    create_missing: bool,
) -> AppResult<ImportResult> {
    check_size(file)?;
    let mut tx = pool.begin().await?;
    let mut out = ImportResult::default();

    for row in &file.collection {
        let name = row.figure_name.trim();
        if name.is_empty() {
            out.skipped.push("collection row without a figure name".into());
            continue;
        }
        let fid = match find_figure(&mut tx, name, row.manufacturer.as_deref(), row.jan.as_deref())
            .await?
        {
            Some(id) => id,
            None if create_missing => {
                let ft = row.figure_type.trim();
                out.figures_created += 1;
                create_figure(
                    &mut tx,
                    user_id,
                    name,
                    ft,
                    row.manufacturer.as_deref(),
                    row.scale.as_deref(),
                    row.jan.as_deref(),
                )
                .await?
            }
            None => {
                out.skipped.push(format!("{name}: not in the catalogue"));
                continue;
            }
        };

        if policy == MergePolicy::Skip {
            let owned: (i64,) = sqlx::query_as(
                "SELECT count(*) FROM owned_items
                 WHERE user_id = $1 AND figure_id = $2 AND archived_at IS NULL",
            )
            .bind(user_id)
            .bind(fid)
            .fetch_one(&mut *tx)
            .await?;
            if owned.0 > 0 {
                continue;
            }
        }

        // "owned ≠ wishlist" is an invariant of the app, so importing a piece
        // into the collection retires any wish for it.
        sqlx::query("DELETE FROM wishlist_items WHERE user_id = $1 AND figure_id = $2")
            .bind(user_id)
            .bind(fid)
            .execute(&mut *tx)
            .await?;

        sqlx::query(
            "INSERT INTO owned_items
                (user_id, figure_id, condition, price_amount, price_currency,
                 value_amount, value_currency, purchase_date)
             VALUES ($1, $2, COALESCE(NULLIF($3, ''), 'good'), $4, $5, $6, $7, $8)",
        )
        .bind(user_id)
        .bind(fid)
        .bind(row.condition.trim())
        .bind(row.paid_amount)
        .bind(row.paid_currency.as_deref())
        .bind(row.value_amount)
        .bind(row.value_currency.as_deref())
        .bind(row.purchase_date)
        .execute(&mut *tx)
        .await?;
        out.collection_added += 1;
    }

    for row in &file.wishlist {
        let name = row.figure_name.trim();
        if name.is_empty() {
            out.skipped.push("wishlist row without a figure name".into());
            continue;
        }
        let fid = match find_figure(&mut tx, name, row.manufacturer.as_deref(), None).await? {
            Some(id) => id,
            None if create_missing => {
                out.figures_created += 1;
                create_figure(
                    &mut tx,
                    user_id,
                    name,
                    "",
                    row.manufacturer.as_deref(),
                    None,
                    None,
                )
                .await?
            }
            None => {
                out.skipped.push(format!("{name}: not in the catalogue"));
                continue;
            }
        };
        // Mirrors the add route's rule: a piece actively owned can't be wished.
        let res = sqlx::query(
            "INSERT INTO wishlist_items (user_id, figure_id, max_price_amount, max_price_currency, note)
             SELECT $1, $2, $3, $4, $5
             WHERE NOT EXISTS (
                 SELECT 1 FROM owned_items
                 WHERE user_id = $1 AND figure_id = $2 AND archived_at IS NULL
             )
             ON CONFLICT (user_id, figure_id) DO NOTHING",
        )
        .bind(user_id)
        .bind(fid)
        .bind(row.target_amount)
        .bind(row.target_currency.as_deref())
        .bind(row.note.as_deref())
        .execute(&mut *tx)
        .await?;
        if res.rows_affected() > 0 {
            out.wishlist_added += 1;
        }
    }

    tx.commit().await?;
    Ok(out)
}

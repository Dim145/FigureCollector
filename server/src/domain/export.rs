//! Data export (Lot 5) — the user's own collection / wishlist / preorders as
//! downloadable CSV or JSON, plus a single-file JSON backup.
//!
//! Everything is scoped to `user_id`. CSV follows RFC 4180 (CRLF rows, fields
//! quoted only when they contain a comma / quote / newline; embedded quotes
//! doubled). JSON is `serde_json` over the same row structs, so the two
//! formats stay in lockstep. Money stays as `Decimal` (no rounding), dates as
//! ISO-8601 — both round-trip cleanly for re-import or a spreadsheet.

use crate::error::AppResult;
use chrono::{DateTime, NaiveDate, Utc};
use rust_decimal::Decimal;
use serde::Serialize;
use sqlx::{FromRow, PgPool};
use uuid::Uuid;

// --- CSV primitives ----------------------------------------------------------

/// Render one CSV cell. Two concerns layered:
///   1. CSV-injection guard: a cell whose first character is a spreadsheet
///      formula trigger (`= + - @`, or a leading tab / CR that Excel strips
///      before re-reading the trigger) is prefixed with a single quote so
///      Excel / LibreOffice treat it as text, never a formula. Figure names,
///      manufacturers and notes come from the shared catalog (any user can
///      seed them), so `=HYPERLINK(...)` in one user's figure must not execute
///      in another user's exported sheet. (OWASP CSV-injection guidance.)
///   2. RFC 4180 quoting: quote when the (possibly prefixed) value carries a
///      delimiter / quote / newline; double any embedded quotes.
fn csv_field(s: &str) -> String {
    let needs_formula_guard = s
        .chars()
        .next()
        .is_some_and(|c| matches!(c, '=' | '+' | '-' | '@' | '\t' | '\r'));
    let guarded = if needs_formula_guard {
        format!("'{s}")
    } else {
        s.to_string()
    };
    if guarded.contains([',', '"', '\n', '\r']) {
        format!("\"{}\"", guarded.replace('"', "\"\""))
    } else {
        guarded
    }
}

fn csv_line(fields: &[String]) -> String {
    fields
        .iter()
        .map(|f| csv_field(f))
        .collect::<Vec<_>>()
        .join(",")
}

/// Assemble a CSV document (UTF-8) from a header row + records, CRLF-joined.
fn build_csv(headers: &[&str], records: &[Vec<String>]) -> String {
    let head = headers.iter().map(|h| csv_field(h)).collect::<Vec<_>>().join(",");
    let mut out = String::with_capacity(64 + records.len() * 48);
    out.push_str(&head);
    for r in records {
        out.push_str("\r\n");
        out.push_str(&csv_line(r));
    }
    out.push_str("\r\n");
    out
}

/// `None` → empty cell; otherwise the value's `Display`.
fn opt<T: ToString>(v: &Option<T>) -> String {
    v.as_ref().map(ToString::to_string).unwrap_or_default()
}

/// Pretty-print to JSON. Serializing these owned row structs is effectively
/// infallible; route the rare error through `Internal` rather than add a
/// dedicated AppError variant.
fn json<T: Serialize>(v: &T) -> AppResult<String> {
    serde_json::to_string_pretty(v).map_err(|e| crate::error::AppError::Internal(e.into()))
}

// --- collection --------------------------------------------------------------

#[derive(Debug, Serialize, FromRow)]
pub struct CollectionRow {
    pub figure_name: String,
    pub figure_type: String,
    pub manufacturer: Option<String>,
    pub scale: Option<String>,
    pub condition: String,
    pub paid_amount: Option<Decimal>,
    pub paid_currency: Option<String>,
    /// Effective value: manual `value_amount` when set, else catalog MSRP.
    pub value_amount: Option<Decimal>,
    pub value_currency: Option<String>,
    pub purchase_date: Option<NaiveDate>,
    pub jan: Option<String>,
}

async fn collection_rows(pool: &PgPool, user_id: Uuid) -> AppResult<Vec<CollectionRow>> {
    Ok(sqlx::query_as::<_, CollectionRow>(
        "SELECT f.name AS figure_name, f.figure_type,
                m.name AS manufacturer, f.scale, o.condition,
                o.price_amount AS paid_amount, o.price_currency AS paid_currency,
                COALESCE(o.value_amount, f.msrp_amount) AS value_amount,
                CASE WHEN o.value_amount IS NOT NULL
                     THEN COALESCE(o.value_currency, o.price_currency, f.msrp_currency)
                     ELSE f.msrp_currency END AS value_currency,
                o.purchase_date, f.jan
         FROM owned_items o
         JOIN figures f ON f.id = o.figure_id
         LEFT JOIN manufacturers m ON m.id = f.manufacturer_id
         WHERE o.user_id = $1
         ORDER BY f.name ASC",
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?)
}

const COLLECTION_HEADERS: &[&str] = &[
    "Nom", "Type", "Fabricant", "Échelle", "État",
    "Prix payé", "Devise", "Valeur estimée", "Devise valeur", "Date d'achat", "JAN",
];

impl CollectionRow {
    fn csv(&self) -> Vec<String> {
        vec![
            self.figure_name.clone(),
            self.figure_type.clone(),
            opt(&self.manufacturer),
            opt(&self.scale),
            self.condition.clone(),
            opt(&self.paid_amount),
            opt(&self.paid_currency),
            opt(&self.value_amount),
            opt(&self.value_currency),
            opt(&self.purchase_date),
            opt(&self.jan),
        ]
    }
}

// --- wishlist ----------------------------------------------------------------

#[derive(Debug, Serialize, FromRow)]
pub struct WishlistRow {
    pub figure_name: String,
    pub manufacturer: Option<String>,
    pub target_amount: Option<Decimal>,
    pub target_currency: Option<String>,
    pub msrp_amount: Option<Decimal>,
    pub msrp_currency: Option<String>,
    pub note: Option<String>,
}

async fn wishlist_rows(pool: &PgPool, user_id: Uuid) -> AppResult<Vec<WishlistRow>> {
    Ok(sqlx::query_as::<_, WishlistRow>(
        "SELECT f.name AS figure_name, m.name AS manufacturer,
                w.max_price_amount AS target_amount, w.max_price_currency AS target_currency,
                f.msrp_amount, f.msrp_currency, w.note
         FROM wishlist_items w
         JOIN figures f ON f.id = w.figure_id
         LEFT JOIN manufacturers m ON m.id = f.manufacturer_id
         WHERE w.user_id = $1
         ORDER BY w.created_at DESC",
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?)
}

const WISHLIST_HEADERS: &[&str] = &[
    "Nom", "Fabricant", "Prix-cible", "Devise cible", "MSRP", "Devise MSRP", "Note",
];

impl WishlistRow {
    fn csv(&self) -> Vec<String> {
        vec![
            self.figure_name.clone(),
            opt(&self.manufacturer),
            opt(&self.target_amount),
            opt(&self.target_currency),
            opt(&self.msrp_amount),
            opt(&self.msrp_currency),
            opt(&self.note),
        ]
    }
}

// --- preorders ---------------------------------------------------------------

#[derive(Debug, Serialize, FromRow)]
pub struct PreorderRow {
    pub figure_name: String,
    pub store: Option<String>,
    pub status: String,
    pub release_date_original: Option<NaiveDate>,
    pub release_date_current: Option<NaiveDate>,
    pub slip_count: i64,
    pub deposit_amount: Option<Decimal>,
    pub currency: Option<String>,
}

async fn preorder_rows(pool: &PgPool, user_id: Uuid) -> AppResult<Vec<PreorderRow>> {
    Ok(sqlx::query_as::<_, PreorderRow>(
        "SELECT f.name AS figure_name, s.name AS store, p.status,
                p.release_date_original, p.release_date_current,
                (SELECT COUNT(*)::bigint FROM preorder_date_history h WHERE h.preorder_id = p.id) AS slip_count,
                p.deposit_amount, p.price_currency AS currency
         FROM preorders p
         JOIN figures f ON f.id = p.figure_id
         LEFT JOIN stores s ON s.id = p.store_id
         WHERE p.user_id = $1
         ORDER BY p.created_at DESC",
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?)
}

const PREORDER_HEADERS: &[&str] = &[
    "Nom", "Boutique", "Statut", "Date initiale", "Date actuelle", "Reports", "Acompte", "Devise",
];

impl PreorderRow {
    fn csv(&self) -> Vec<String> {
        vec![
            self.figure_name.clone(),
            opt(&self.store),
            self.status.clone(),
            opt(&self.release_date_original),
            opt(&self.release_date_current),
            self.slip_count.to_string(),
            opt(&self.deposit_amount),
            opt(&self.currency),
        ]
    }
}

// --- public CSV / JSON entry points ------------------------------------------

pub async fn collection_csv(pool: &PgPool, user_id: Uuid) -> AppResult<String> {
    let rows = collection_rows(pool, user_id).await?;
    let recs: Vec<_> = rows.iter().map(CollectionRow::csv).collect();
    Ok(build_csv(COLLECTION_HEADERS, &recs))
}

pub async fn collection_json(pool: &PgPool, user_id: Uuid) -> AppResult<String> {
    let rows = collection_rows(pool, user_id).await?;
    json(&rows)
}

pub async fn wishlist_csv(pool: &PgPool, user_id: Uuid) -> AppResult<String> {
    let rows = wishlist_rows(pool, user_id).await?;
    let recs: Vec<_> = rows.iter().map(WishlistRow::csv).collect();
    Ok(build_csv(WISHLIST_HEADERS, &recs))
}

pub async fn wishlist_json(pool: &PgPool, user_id: Uuid) -> AppResult<String> {
    let rows = wishlist_rows(pool, user_id).await?;
    json(&rows)
}

pub async fn preorders_csv(pool: &PgPool, user_id: Uuid) -> AppResult<String> {
    let rows = preorder_rows(pool, user_id).await?;
    let recs: Vec<_> = rows.iter().map(PreorderRow::csv).collect();
    Ok(build_csv(PREORDER_HEADERS, &recs))
}

pub async fn preorders_json(pool: &PgPool, user_id: Uuid) -> AppResult<String> {
    let rows = preorder_rows(pool, user_id).await?;
    json(&rows)
}

// --- full backup -------------------------------------------------------------

#[derive(Serialize, FromRow)]
struct BackupUser {
    username: String,
    display_name: String,
}

#[derive(Serialize)]
struct Backup {
    app: &'static str,
    version: &'static str,
    exported_at: DateTime<Utc>,
    user: BackupUser,
    collection: Vec<CollectionRow>,
    wishlist: Vec<WishlistRow>,
    preorders: Vec<PreorderRow>,
}

/// One JSON file with everything — meant for archival / re-import / migration.
pub async fn backup_json(pool: &PgPool, user_id: Uuid) -> AppResult<String> {
    let user: BackupUser =
        sqlx::query_as("SELECT username, display_name FROM users WHERE id = $1")
            .bind(user_id)
            .fetch_one(pool)
            .await?;
    let backup = Backup {
        app: "FigureCollector",
        version: env!("CARGO_PKG_VERSION"),
        exported_at: Utc::now(),
        user,
        collection: collection_rows(pool, user_id).await?,
        wishlist: wishlist_rows(pool, user_id).await?,
        preorders: preorder_rows(pool, user_id).await?,
    };
    json(&backup)
}

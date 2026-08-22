//! Arrival QC — dated condition reports and their defect log.
//!
//! Unboxing is where the money is lost (warped sword, paint transfer, snapped
//! peg) and claim windows are short. `owned_items.condition` is one mutable
//! string with no history, so a piece that arrived damaged, was refunded 30%
//! and then repaired reads exactly like one that arrived mint.
//!
//! A report is an immutable-ish dated snapshot with defects hanging off it.
//! Opening an **arrival** report starts two countdowns — the shop's DOA window
//! and the carrier's claim window — which [`open_windows`] feeds to the daily
//! cron so the user is warned *before* the door closes rather than after.
//!
//! Every query is scoped by `user_id`: reports describe damage to someone's
//! own property and must never be readable across accounts. Defect evidence
//! points at `owned_item_documents` (owner-only private storage), never at
//! `figure_photos` — a cracked figure must not surface in a shared vitrine.

use crate::error::{AppError, AppResult};
use chrono::{DateTime, NaiveDate, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, PgPool};
use uuid::Uuid;

pub const KINDS: &[&str] = &["arrival", "periodic", "post_repair"];
pub const ZONES: &[&str] = &["paint", "joint", "seam", "base", "accessory", "box", "other"];
pub const CLAIM_STATUSES: &[&str] =
    &["none", "opened", "refunded", "replaced", "partial", "refused"];
const GRADES: &[&str] = &["A+", "A", "A-", "B+", "B", "C", "J"];

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct Defect {
    pub id: Uuid,
    pub report_id: Uuid,
    pub zone: String,
    pub severity: i16,
    pub note: Option<String>,
    pub document_id: Option<Uuid>,
    pub resolved_on: Option<NaiveDate>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct Report {
    pub id: Uuid,
    pub owned_item_id: Uuid,
    pub kind: String,
    pub reported_on: NaiveDate,
    pub overall_grade: Option<String>,
    pub note: Option<String>,
    pub doa_deadline: Option<NaiveDate>,
    pub carrier_deadline: Option<NaiveDate>,
    pub claim_status: String,
    pub claim_amount: Option<Decimal>,
    pub claim_currency: Option<String>,
    pub claim_closed_on: Option<NaiveDate>,
    pub created_at: DateTime<Utc>,
}

/// A report plus its defects — what the UI renders in one go.
#[derive(Debug, Clone, Serialize)]
pub struct ReportWithDefects {
    #[serde(flatten)]
    pub report: Report,
    pub defects: Vec<Defect>,
}

#[derive(Debug, Deserialize)]
pub struct NewReport {
    #[serde(default = "default_kind")]
    pub kind: String,
    #[serde(default)]
    pub reported_on: Option<NaiveDate>,
    #[serde(default)]
    pub overall_grade: Option<String>,
    #[serde(default)]
    pub note: Option<String>,
    #[serde(default)]
    pub doa_deadline: Option<NaiveDate>,
    #[serde(default)]
    pub carrier_deadline: Option<NaiveDate>,
}

fn default_kind() -> String {
    "arrival".to_string()
}

#[derive(Debug, Deserialize)]
pub struct ReportPatch {
    #[serde(default)]
    pub overall_grade: Option<String>,
    #[serde(default)]
    pub note: Option<String>,
    #[serde(default)]
    pub doa_deadline: Option<NaiveDate>,
    #[serde(default)]
    pub carrier_deadline: Option<NaiveDate>,
    #[serde(default)]
    pub claim_status: Option<String>,
    #[serde(default)]
    pub claim_amount: Option<Decimal>,
    #[serde(default)]
    pub claim_currency: Option<String>,
    #[serde(default)]
    pub claim_closed_on: Option<NaiveDate>,
}

#[derive(Debug, Deserialize)]
pub struct NewDefect {
    pub zone: String,
    #[serde(default = "one")]
    pub severity: i16,
    #[serde(default)]
    pub note: Option<String>,
    #[serde(default)]
    pub document_id: Option<Uuid>,
}

fn one() -> i16 {
    1
}

fn check_grade(g: &Option<String>) -> AppResult<()> {
    if let Some(g) = g {
        if !GRADES.contains(&g.as_str()) {
            return Err(AppError::BadRequest("invalid overall_grade"));
        }
    }
    Ok(())
}

/// Confirm the piece belongs to this user before anything is written against
/// it — the owned-item id arrives from the client.
async fn assert_owns(pool: &PgPool, user_id: Uuid, owned_item_id: Uuid) -> AppResult<()> {
    let hit: Option<(Uuid,)> =
        sqlx::query_as("SELECT id FROM owned_items WHERE id = $1 AND user_id = $2")
            .bind(owned_item_id)
            .bind(user_id)
            .fetch_optional(pool)
            .await?;
    hit.map(|_| ()).ok_or(AppError::NotFound)
}

pub async fn create(
    pool: &PgPool,
    user_id: Uuid,
    owned_item_id: Uuid,
    input: NewReport,
) -> AppResult<Report> {
    if !KINDS.contains(&input.kind.as_str()) {
        return Err(AppError::BadRequest("invalid report kind"));
    }
    check_grade(&input.overall_grade)?;
    assert_owns(pool, user_id, owned_item_id).await?;

    Ok(sqlx::query_as::<_, Report>(
        "INSERT INTO condition_reports
            (owned_item_id, user_id, kind, reported_on, overall_grade, note,
             doa_deadline, carrier_deadline)
         VALUES ($1, $2, $3, COALESCE($4, current_date), $5, $6, $7, $8)
         RETURNING id, owned_item_id, kind, reported_on, overall_grade, note,
                   doa_deadline, carrier_deadline, claim_status, claim_amount,
                   claim_currency, claim_closed_on, created_at",
    )
    .bind(owned_item_id)
    .bind(user_id)
    .bind(&input.kind)
    .bind(input.reported_on)
    .bind(&input.overall_grade)
    .bind(&input.note)
    .bind(input.doa_deadline)
    .bind(input.carrier_deadline)
    .fetch_one(pool)
    .await?)
}

/// Every report for one piece, newest first, each with its defects.
pub async fn list_for_item(
    pool: &PgPool,
    user_id: Uuid,
    owned_item_id: Uuid,
) -> AppResult<Vec<ReportWithDefects>> {
    let reports = sqlx::query_as::<_, Report>(
        "SELECT id, owned_item_id, kind, reported_on, overall_grade, note,
                doa_deadline, carrier_deadline, claim_status, claim_amount,
                claim_currency, claim_closed_on, created_at
         FROM condition_reports
         WHERE owned_item_id = $1 AND user_id = $2
         ORDER BY reported_on DESC, created_at DESC",
    )
    .bind(owned_item_id)
    .bind(user_id)
    .fetch_all(pool)
    .await?;
    if reports.is_empty() {
        return Ok(vec![]);
    }

    // One round-trip for every defect of every report, rather than N queries.
    let ids: Vec<Uuid> = reports.iter().map(|r| r.id).collect();
    let defects = sqlx::query_as::<_, Defect>(
        "SELECT id, report_id, zone, severity, note, document_id, resolved_on, created_at
         FROM condition_defects
         WHERE report_id = ANY($1)
         ORDER BY created_at ASC",
    )
    .bind(&ids)
    .fetch_all(pool)
    .await?;

    let mut by_report: std::collections::HashMap<Uuid, Vec<Defect>> =
        std::collections::HashMap::new();
    for d in defects {
        by_report.entry(d.report_id).or_default().push(d);
    }
    Ok(reports
        .into_iter()
        .map(|r| ReportWithDefects {
            defects: by_report.remove(&r.id).unwrap_or_default(),
            report: r,
        })
        .collect())
}

pub async fn patch(
    pool: &PgPool,
    user_id: Uuid,
    report_id: Uuid,
    input: ReportPatch,
) -> AppResult<Report> {
    check_grade(&input.overall_grade)?;
    if let Some(s) = &input.claim_status {
        if !CLAIM_STATUSES.contains(&s.as_str()) {
            return Err(AppError::BadRequest("invalid claim_status"));
        }
    }
    if let Some(c) = &input.claim_currency {
        if !crate::domain::currency::is_supported(c) {
            return Err(AppError::BadRequest(
                "claim_currency must be a supported currency code",
            ));
        }
    }
    sqlx::query_as::<_, Report>(
        "UPDATE condition_reports SET
            overall_grade    = COALESCE($1, overall_grade),
            note             = COALESCE($2, note),
            doa_deadline     = COALESCE($3, doa_deadline),
            carrier_deadline = COALESCE($4, carrier_deadline),
            claim_status     = COALESCE($5, claim_status),
            claim_amount     = COALESCE($6, claim_amount),
            claim_currency   = COALESCE($7, claim_currency),
            claim_closed_on  = COALESCE($8, claim_closed_on),
            updated_at       = now()
         WHERE id = $9 AND user_id = $10
         RETURNING id, owned_item_id, kind, reported_on, overall_grade, note,
                   doa_deadline, carrier_deadline, claim_status, claim_amount,
                   claim_currency, claim_closed_on, created_at",
    )
    .bind(&input.overall_grade)
    .bind(&input.note)
    .bind(input.doa_deadline)
    .bind(input.carrier_deadline)
    .bind(&input.claim_status)
    .bind(input.claim_amount)
    .bind(&input.claim_currency)
    .bind(input.claim_closed_on)
    .bind(report_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::NotFound)
}

pub async fn delete(pool: &PgPool, user_id: Uuid, report_id: Uuid) -> AppResult<()> {
    let res = sqlx::query("DELETE FROM condition_reports WHERE id = $1 AND user_id = $2")
        .bind(report_id)
        .bind(user_id)
        .execute(pool)
        .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    Ok(())
}

pub async fn add_defect(
    pool: &PgPool,
    user_id: Uuid,
    report_id: Uuid,
    input: NewDefect,
) -> AppResult<Defect> {
    if !ZONES.contains(&input.zone.as_str()) {
        return Err(AppError::BadRequest("invalid defect zone"));
    }
    if !(1..=3).contains(&input.severity) {
        return Err(AppError::BadRequest("severity must be 1..3"));
    }
    // The report must be the caller's, and so must any document attached as
    // evidence — otherwise a crafted id could pin someone else's private
    // receipt to your defect log.
    let owns_report: Option<(Uuid,)> =
        sqlx::query_as("SELECT id FROM condition_reports WHERE id = $1 AND user_id = $2")
            .bind(report_id)
            .bind(user_id)
            .fetch_optional(pool)
            .await?;
    owns_report.ok_or(AppError::NotFound)?;
    if let Some(doc) = input.document_id {
        let owns_doc: Option<(Uuid,)> =
            sqlx::query_as("SELECT id FROM owned_item_documents WHERE id = $1 AND user_id = $2")
                .bind(doc)
                .bind(user_id)
                .fetch_optional(pool)
                .await?;
        owns_doc.ok_or(AppError::NotFound)?;
    }

    Ok(sqlx::query_as::<_, Defect>(
        "INSERT INTO condition_defects (report_id, zone, severity, note, document_id)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, report_id, zone, severity, note, document_id, resolved_on, created_at",
    )
    .bind(report_id)
    .bind(&input.zone)
    .bind(input.severity)
    .bind(&input.note)
    .bind(input.document_id)
    .fetch_one(pool)
    .await?)
}

/// Mark a defect fixed (or un-fix it by sending `None`).
pub async fn resolve_defect(
    pool: &PgPool,
    user_id: Uuid,
    defect_id: Uuid,
    resolved_on: Option<NaiveDate>,
) -> AppResult<Defect> {
    sqlx::query_as::<_, Defect>(
        "UPDATE condition_defects d SET resolved_on = $1
         FROM condition_reports r
         WHERE d.id = $2 AND d.report_id = r.id AND r.user_id = $3
         RETURNING d.id, d.report_id, d.zone, d.severity, d.note, d.document_id,
                   d.resolved_on, d.created_at",
    )
    .bind(resolved_on)
    .bind(defect_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::NotFound)
}

pub async fn delete_defect(pool: &PgPool, user_id: Uuid, defect_id: Uuid) -> AppResult<()> {
    let res = sqlx::query(
        "DELETE FROM condition_defects d
         USING condition_reports r
         WHERE d.id = $1 AND d.report_id = r.id AND r.user_id = $2",
    )
    .bind(defect_id)
    .bind(user_id)
    .execute(pool)
    .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    Ok(())
}

/// A claim window about to close, for the daily cron.
#[derive(Debug, Clone, FromRow)]
pub struct ClosingWindow {
    pub report_id: Uuid,
    pub user_id: Uuid,
    pub owned_item_id: Uuid,
    pub figure_name: String,
    /// "doa" | "carrier" — which counter is running out.
    pub which: String,
    pub deadline: NaiveDate,
}

/// Windows closing within `days` (and not already past), for reports whose
/// claim isn't settled. Warning *before* the door shuts is the whole point —
/// a notification the day after is just bad news.
pub async fn closing_windows(pool: &PgPool, days: i64) -> AppResult<Vec<ClosingWindow>> {
    Ok(sqlx::query_as::<_, ClosingWindow>(
        "SELECT r.id AS report_id, r.user_id, r.owned_item_id, f.name AS figure_name,
                w.which, w.deadline
         FROM condition_reports r
         JOIN owned_items o ON o.id = r.owned_item_id
         JOIN figures f     ON f.id = o.figure_id
         CROSS JOIN LATERAL (
             VALUES ('doa', r.doa_deadline), ('carrier', r.carrier_deadline)
         ) AS w(which, deadline)
         WHERE r.claim_status IN ('none','opened')
           AND w.deadline IS NOT NULL
           AND w.deadline >= current_date
           AND w.deadline <= current_date + ($1::int * INTERVAL '1 day')",
    )
    .bind(days as i32)
    .fetch_all(pool)
    .await?)
}

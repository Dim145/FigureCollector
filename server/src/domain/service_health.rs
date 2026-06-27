//! Liveness register for the server's long-lived background SERVICES.
//!
//! `server_job_runs` keeps a per-run HISTORY, which fits the crons (each sweep
//! is a discrete run). It does NOT fit the always-on services — listeners,
//! pollers, fan-out workers — which have no discrete runs, just a stream of
//! activity. Those write a single upserted row here on each "beat", so the
//! admin Tasks console can show every service's liveness (last beat, status,
//! last error) regardless of whether it produces runs.
//!
//! Heartbeats are deliberately best-effort: a DB hiccup on a beat must never
//! take down (or stall) the service it is instrumenting. [`beat`] and
//! [`record_error`] therefore swallow + log their own DB errors and always
//! return `Ok(())`.

use crate::error::AppResult;
use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::{FromRow, PgPool};

/// One service's current liveness, as the admin Tasks console reads it.
#[derive(Debug, Clone, Serialize, FromRow)]
pub struct ServiceHealth {
    pub service_name: String,
    /// Coarse category: `cron` | `listener` | `poller` | `fanout` (free-form;
    /// drives the console grouping/iconography).
    pub kind: String,
    /// `ok` | `error` (free-form; the last status the service reported).
    pub status: String,
    /// Service-specific snapshot, e.g. queue counts or the last dispatch info.
    pub detail: Option<serde_json::Value>,
    pub last_beat_at: DateTime<Utc>,
    pub last_error: Option<String>,
    pub last_error_at: Option<DateTime<Utc>>,
}

/// Record a healthy beat (UPSERT). Refreshes `kind`, `status`, `detail` and
/// `last_beat_at`; leaves `last_error*` untouched so the last failure stays
/// visible until the next error. Best-effort: logs and swallows DB errors.
pub async fn beat(
    pool: &PgPool,
    name: &str,
    kind: &str,
    status: &str,
    detail: Option<serde_json::Value>,
) -> AppResult<()> {
    let res = sqlx::query(
        "INSERT INTO service_heartbeats (service_name, kind, status, detail, last_beat_at)
         VALUES ($1, $2, $3, $4, now())
         ON CONFLICT (service_name) DO UPDATE
            SET kind = EXCLUDED.kind,
                status = EXCLUDED.status,
                detail = EXCLUDED.detail,
                last_beat_at = now()",
    )
    .bind(name)
    .bind(kind)
    .bind(status)
    .bind(detail)
    .execute(pool)
    .await;
    if let Err(e) = res {
        tracing::warn!(service = name, error = ?e, "service heartbeat write failed");
    }
    Ok(())
}

/// Record a failure (UPSERT): `status = 'error'`, sets `last_error*`, and also
/// bumps `last_beat_at` (the service is still alive, just degraded). On a brand
/// new row `kind` is unknown, so we seed it `'unknown'`; an existing row keeps
/// its `kind`. Best-effort: logs and swallows DB errors.
pub async fn record_error(pool: &PgPool, name: &str, msg: &str) -> AppResult<()> {
    let res = sqlx::query(
        "INSERT INTO service_heartbeats
            (service_name, kind, status, last_beat_at, last_error, last_error_at)
         VALUES ($1, 'unknown', 'error', now(), $2, now())
         ON CONFLICT (service_name) DO UPDATE
            SET status = 'error',
                last_error = EXCLUDED.last_error,
                last_error_at = now(),
                last_beat_at = now()",
    )
    .bind(name)
    .bind(msg)
    .execute(pool)
    .await;
    if let Err(e) = res {
        tracing::warn!(service = name, error = ?e, "service error heartbeat write failed");
    }
    Ok(())
}

/// Every service's current liveness, name-ordered, for the admin Tasks console.
pub async fn list(pool: &PgPool) -> AppResult<Vec<ServiceHealth>> {
    Ok(sqlx::query_as::<_, ServiceHealth>(
        "SELECT service_name, kind, status, detail, last_beat_at, last_error, last_error_at
         FROM service_heartbeats
         ORDER BY service_name",
    )
    .fetch_all(pool)
    .await?)
}

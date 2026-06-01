//! MangaCollector server registry (Lot 8b · security).
//!
//! The set of MangaCollector origins FigureCollector is allowed to talk to.
//! A user links by choosing an `approved` server, or by submitting a new one —
//! which lands `pending` and is **inert** until an admin approves it. Revoking
//! flips a server to `revoked`, which disables every link pointing at it.
//!
//! This registry is a *policy* gate layered on top of the network gate: every
//! outbound fetch still runs through `external::notify_channel::validate_outbound_url`
//! (DNS resolve + private-IP denylist) and the no-redirect client. Submitting a
//! server SSRF-validates the origin up front, so a private/loopback target is
//! rejected before a `pending` row is ever created.

use crate::error::{AppError, AppResult};
use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::{FromRow, PgPool};
use uuid::Uuid;

/// The initial status of a freshly-submitted server. Exported for API
/// symmetry; the value is written as a SQL literal in `submit`.
#[allow(dead_code)]
pub const STATUS_PENDING: &str = "pending";
pub const STATUS_APPROVED: &str = "approved";
pub const STATUS_REVOKED: &str = "revoked";

/// Most pending submissions a single non-admin user may have outstanding —
/// a soft anti-spam cap on the review queue.
const MAX_PENDING_PER_USER: i64 = 10;

// ─── Row shapes ──────────────────────────────────────────────────────────────

/// A registry row.
#[derive(Debug, Clone, Serialize, FromRow)]
pub struct MangaServer {
    pub id: Uuid,
    pub base_url: String,
    pub label: Option<String>,
    pub status: String,
    pub submitted_by: Option<Uuid>,
    pub reviewed_by: Option<Uuid>,
    pub reviewed_at: Option<DateTime<Utc>>,
    pub note: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Admin-list projection — registry row enriched with usernames + how many
/// users currently point at it.
#[derive(Debug, Clone, Serialize, FromRow)]
pub struct MangaServerAdmin {
    pub id: Uuid,
    pub base_url: String,
    pub label: Option<String>,
    pub status: String,
    pub note: Option<String>,
    pub reviewed_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub submitted_by_username: Option<String>,
    pub reviewed_by_username: Option<String>,
    pub user_count: i64,
}

/// Picker projection — just what the settings drawer needs for an approved
/// server.
#[derive(Debug, Clone, Serialize, FromRow)]
pub struct MangaServerOption {
    pub id: Uuid,
    pub base_url: String,
    pub label: Option<String>,
}

/// The server a user is currently linked to, with its live status — drives the
/// "active / pending / revoked" UI and gates every outbound fetch.
#[derive(Debug, Clone, FromRow)]
pub struct LinkedServer {
    pub server_id: Uuid,
    pub base_url: String,
    pub status: String,
    pub label: Option<String>,
    pub note: Option<String>,
    pub slug: String,
}

impl LinkedServer {
    pub fn is_approved(&self) -> bool {
        self.status == STATUS_APPROVED
    }
}

// ─── URL normalization ───────────────────────────────────────────────────────

/// Canonicalise a user-supplied instance URL into the registry's identity key:
/// lower-cased scheme + host, explicit non-default port, path kept (minus any
/// trailing slash), no userinfo / query / fragment. http(s) only.
///
/// So `https://Manga.Foo/` and `https://manga.foo` collapse to one server,
/// and `https://manga.foo:443` collapses to `https://manga.foo`.
pub fn normalize_base_url(input: &str) -> AppResult<String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err(AppError::BadRequest("manga server URL is required"));
    }
    let mut url = reqwest::Url::parse(trimmed)
        .map_err(|_| AppError::BadRequest("manga server URL is not a valid URL"))?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err(AppError::BadRequest("manga server URL must be http or https"));
    }
    if url.host_str().is_none() {
        return Err(AppError::BadRequest("manga server URL must have a host"));
    }
    // Strip credentials / query / fragment — none belong in an origin key.
    let _ = url.set_username("");
    let _ = url.set_password(None);
    url.set_query(None);
    url.set_fragment(None);
    // Drop a default port so :443 / :80 don't fork the identity.
    if let Some(port) = url.port() {
        let default = match url.scheme() {
            "https" => 443,
            _ => 80,
        };
        if port == default {
            let _ = url.set_port(None);
        }
    }
    // `Url` lower-cases the host already; trim any trailing slash on the path.
    let mut s = url.to_string();
    while s.ends_with('/') {
        s.pop();
    }
    if s.is_empty() {
        return Err(AppError::BadRequest("manga server URL is not valid"));
    }
    Ok(s)
}

// ─── Lookups ─────────────────────────────────────────────────────────────────

const SERVER_COLS: &str = "id, base_url, label, status, submitted_by, reviewed_by, \
                           reviewed_at, note, created_at, updated_at";

pub async fn find_by_id(pool: &PgPool, id: Uuid) -> AppResult<Option<MangaServer>> {
    Ok(
        sqlx::query_as::<_, MangaServer>(&format!(
            "SELECT {SERVER_COLS} FROM manga_servers WHERE id = $1"
        ))
        .bind(id)
        .fetch_optional(pool)
        .await?,
    )
}

/// Every approved server, for the user-facing picker.
pub async fn list_approved(pool: &PgPool) -> AppResult<Vec<MangaServerOption>> {
    Ok(sqlx::query_as::<_, MangaServerOption>(
        "SELECT id, base_url, label FROM manga_servers
         WHERE status = 'approved'
         ORDER BY label NULLS LAST, base_url",
    )
    .fetch_all(pool)
    .await?)
}

/// Full registry for the admin page — pending first, then approved, then
/// revoked; newest within each group.
pub async fn list_all_admin(pool: &PgPool) -> AppResult<Vec<MangaServerAdmin>> {
    Ok(sqlx::query_as::<_, MangaServerAdmin>(
        "SELECT ms.id, ms.base_url, ms.label, ms.status, ms.note, ms.reviewed_at,
                ms.created_at, ms.updated_at,
                sub.username AS submitted_by_username,
                rev.username AS reviewed_by_username,
                (SELECT COUNT(*) FROM users u WHERE u.manga_server_id = ms.id) AS user_count
         FROM manga_servers ms
         LEFT JOIN users sub ON sub.id = ms.submitted_by
         LEFT JOIN users rev ON rev.id = ms.reviewed_by
         ORDER BY CASE ms.status
                    WHEN 'pending'  THEN 0
                    WHEN 'approved' THEN 1
                    ELSE 2
                  END,
                  ms.created_at DESC",
    )
    .fetch_all(pool)
    .await?)
}

/// The user IDs currently linked to a server — the audience for an
/// approve / revoke notification.
pub async fn linked_user_ids(pool: &PgPool, server_id: Uuid) -> AppResult<Vec<Uuid>> {
    let rows: Vec<(Uuid,)> =
        sqlx::query_as("SELECT id FROM users WHERE manga_server_id = $1")
            .bind(server_id)
            .fetch_all(pool)
            .await?;
    Ok(rows.into_iter().map(|r| r.0).collect())
}

// ─── Submission (user) ─────────────────────────────────────────────────────────

/// Submit a server by URL. Normalises + SSRF-validates the origin, then upserts:
/// an existing row (any status) is returned as-is; a brand-new URL is inserted
/// `pending`. The caller inspects the returned status — `approved` means the
/// user is connected immediately, `pending` means "awaiting an admin",
/// `revoked` should be refused.
pub async fn submit(pool: &PgPool, user_id: Uuid, raw_url: &str) -> AppResult<MangaServer> {
    let base_url = normalize_base_url(raw_url)?;

    // Network gate first — a private/loopback/metadata target never reaches the
    // registry. Reuses the exact guard the webhook/ntfy adapters use.
    crate::external::notify_channel::validate_outbound_url(&base_url)
        .await
        .map_err(|_| AppError::BadRequest("manga server URL not allowed"))?;

    // If it already exists, hand it back regardless of status (no new row).
    if let Some(existing) = find_by_base_url(pool, &base_url).await? {
        return Ok(existing);
    }

    // Soft anti-spam: cap a user's outstanding pending submissions.
    let pending: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM manga_servers WHERE submitted_by = $1 AND status = 'pending'",
    )
    .bind(user_id)
    .fetch_one(pool)
    .await?;
    if pending.0 >= MAX_PENDING_PER_USER {
        return Err(AppError::BadRequest(
            "too many pending server submissions — wait for an admin to review them",
        ));
    }

    Ok(sqlx::query_as::<_, MangaServer>(&format!(
        "INSERT INTO manga_servers (base_url, status, submitted_by)
         VALUES ($1, 'pending', $2)
         RETURNING {SERVER_COLS}"
    ))
    .bind(&base_url)
    .bind(user_id)
    .fetch_one(pool)
    .await?)
}

async fn find_by_base_url(pool: &PgPool, base_url: &str) -> AppResult<Option<MangaServer>> {
    Ok(
        sqlx::query_as::<_, MangaServer>(&format!(
            "SELECT {SERVER_COLS} FROM manga_servers WHERE base_url = $1"
        ))
        .bind(base_url)
        .fetch_optional(pool)
        .await?,
    )
}

// ─── Admin lifecycle ────────────────────────────────────────────────────────

/// Approve a `pending` (or re-approve a `revoked`) server. Clears any stale
/// revocation note. Returns `NotFound` if the id doesn't exist.
pub async fn approve(pool: &PgPool, id: Uuid, admin_id: Uuid) -> AppResult<MangaServer> {
    sqlx::query_as::<_, MangaServer>(&format!(
        "UPDATE manga_servers
         SET status = 'approved', reviewed_by = $2, reviewed_at = now(), note = NULL
         WHERE id = $1
         RETURNING {SERVER_COLS}"
    ))
    .bind(id)
    .bind(admin_id)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::NotFound)
}

/// Revoke a server with an optional reason. Returns the updated row plus the
/// list of users who were linked to it (so the caller can notify them). The
/// links are left intact (status drives the dormant "revoked" UI) — fetches
/// are gated on `approved`, so the integration simply stops.
pub async fn revoke(
    pool: &PgPool,
    id: Uuid,
    admin_id: Uuid,
    note: Option<&str>,
) -> AppResult<(MangaServer, Vec<Uuid>)> {
    let note = note.map(str::trim).filter(|s| !s.is_empty());
    let server = sqlx::query_as::<_, MangaServer>(&format!(
        "UPDATE manga_servers
         SET status = 'revoked', reviewed_by = $2, reviewed_at = now(), note = $3
         WHERE id = $1
         RETURNING {SERVER_COLS}"
    ))
    .bind(id)
    .bind(admin_id)
    .bind(note)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::NotFound)?;

    let affected = linked_user_ids(pool, id).await?;
    Ok((server, affected))
}

/// Set / clear the friendly label. Empty trims to `NULL`.
pub async fn set_label(pool: &PgPool, id: Uuid, label: Option<&str>) -> AppResult<MangaServer> {
    let label = label.map(str::trim).filter(|s| !s.is_empty());
    sqlx::query_as::<_, MangaServer>(&format!(
        "UPDATE manga_servers SET label = $2 WHERE id = $1 RETURNING {SERVER_COLS}"
    ))
    .bind(id)
    .bind(label)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::NotFound)
}

/// Delete a server — only when no user points at it. Revoke an in-use server
/// instead. `BadRequest` if still in use, `NotFound` if the id is unknown.
pub async fn delete(pool: &PgPool, id: Uuid) -> AppResult<()> {
    if find_by_id(pool, id).await?.is_none() {
        return Err(AppError::NotFound);
    }
    let users = linked_user_ids(pool, id).await?;
    if !users.is_empty() {
        return Err(AppError::BadRequest(
            "this server is still in use — revoke it before deleting",
        ));
    }
    sqlx::query("DELETE FROM manga_servers WHERE id = $1")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

// ─── User link (server_id + slug on the users row) ──────────────────────────

/// The user's current link, or `None` when unlinked / no slug.
pub async fn get_link(pool: &PgPool, user_id: Uuid) -> AppResult<Option<LinkedServer>> {
    Ok(sqlx::query_as::<_, LinkedServer>(
        "SELECT ms.id AS server_id, ms.base_url, ms.status, ms.label, ms.note,
                u.manga_slug AS slug
         FROM users u
         JOIN manga_servers ms ON ms.id = u.manga_server_id
         WHERE u.id = $1 AND u.manga_slug IS NOT NULL",
    )
    .bind(user_id)
    .fetch_optional(pool)
    .await?)
}

/// Point the user at `server_id` with `slug`.
pub async fn set_link(pool: &PgPool, user_id: Uuid, server_id: Uuid, slug: &str) -> AppResult<()> {
    sqlx::query("UPDATE users SET manga_server_id = $1, manga_slug = $2 WHERE id = $3")
        .bind(server_id)
        .bind(slug.trim())
        .bind(user_id)
        .execute(pool)
        .await?;
    Ok(())
}

/// Drop the user's link (both columns back to NULL).
pub async fn clear_link(pool: &PgPool, user_id: Uuid) -> AppResult<()> {
    sqlx::query("UPDATE users SET manga_server_id = NULL, manga_slug = NULL WHERE id = $1")
        .bind(user_id)
        .execute(pool)
        .await?;
    Ok(())
}

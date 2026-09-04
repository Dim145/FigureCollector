//! Authentication primitives.

pub mod local;
pub mod oidc;
pub mod sessions;
pub mod user;

use crate::domain::api_key::{self, ScopeSet};
use crate::error::{AppError, AppResult};
use axum::http::{HeaderMap, header};
use sqlx::PgPool;
use tower_sessions::Session;
use uuid::Uuid;

/// Pull the authenticated user id from the session, or `Unauthorized`.
pub async fn require_user(session: &Session) -> AppResult<Uuid> {
    session
        .get::<Uuid>("user_id")
        .await?
        .ok_or(AppError::Unauthorized)
}

/// Pull the authenticated user id from the session if present; `None` when
/// the caller is anonymous. Use for viewer-aware *public* endpoints that must
/// stay reachable without a session (the flags they compute just default to
/// "no relationship" for anonymous callers).
pub async fn optional_user(session: &Session) -> AppResult<Option<Uuid>> {
    Ok(session.get::<Uuid>("user_id").await?)
}

/// Resolve the session to a full `User` row, or `Unauthorized` if the
/// session is missing / dangling. Use this when the handler needs to read
/// the role (or other profile bits) past the id.
pub async fn require_user_full(session: &Session, pool: &PgPool) -> AppResult<user::User> {
    let id = require_user(session).await?;
    user::find_by_id(pool, id).await?.ok_or_else(|| {
        // Session referenced a vanished user — flush so we stop trusting it.
        // Best-effort; we still surface Unauthorized either way.
        tracing::warn!(user_id = %id, "session referenced deleted user");
        AppError::Unauthorized
    })
}

/// Like `require_user_full`, but also fails with `Forbidden` if the user
/// isn't an admin. Every admin route should gate through this.
pub async fn require_admin(session: &Session, pool: &PgPool) -> AppResult<user::User> {
    let user = require_user_full(session, pool).await?;
    if !user.is_admin {
        return Err(AppError::Forbidden);
    }
    Ok(user)
}

/// Constant-time byte-slice equality. Folds a length difference into the
/// accumulator so unequal lengths still take the same path (no early return on
/// length), avoiding a timing side-channel on secret comparison.
///
/// Shared by the worker-internal token check (`routes::photos`) and the API-key
/// hash comparison (`domain::api_key`).
pub fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    // Fold the length difference at full width. Narrowing it to `u8` first
    // would discard the high bits, so two slices whose lengths differ by a
    // multiple of 256 — with a matching overlap and a NUL tail — would compare
    // equal. Neither caller can currently produce that, but the accumulator is
    // the wrong place to be clever.
    let mut diff = (a.len() ^ b.len()) as u64;
    let n = a.len().max(b.len());
    for i in 0..n {
        let x = a.get(i).copied().unwrap_or(0);
        let y = b.get(i).copied().unwrap_or(0);
        diff |= u64::from(x ^ y);
    }
    diff == 0
}

/// Who is calling the MCP endpoint, and what they may do.
///
/// Note what this does *not* carry any authority for: `user.is_admin` is
/// readable (it's part of the `User` row) but the MCP layer must never branch
/// on it. Administration is out of scope by design, not by scope — see
/// `routes::mcp`.
#[derive(Debug, Clone)]
pub struct McpPrincipal {
    pub user: user::User,
    /// The key that authenticated this request, for the audit trail.
    pub key_id: Uuid,
    pub scopes: ScopeSet,
}

/// Pull the presented API key out of the request headers.
///
/// `Authorization: Bearer <token>` is the spec-aligned form and what MCP
/// clients send. `X-Api-Key` is accepted as a fallback for clients that can
/// only set a custom header, not `Authorization`.
fn presented_key(headers: &HeaderMap) -> Option<&str> {
    let bearer = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .map(str::trim)
        .filter(|v| !v.is_empty());
    bearer.or_else(|| {
        headers
            .get("x-api-key")
            .and_then(|v| v.to_str().ok())
            .map(str::trim)
            .filter(|v| !v.is_empty())
    })
}

/// Resolve an API key to its owner. `Unauthorized` for every failure mode
/// (absent, malformed, unknown, revoked, expired, dangling user) so the
/// endpoint reveals nothing about which keys exist.
pub async fn require_api_key(headers: &HeaderMap, pool: &PgPool) -> AppResult<McpPrincipal> {
    let token = presented_key(headers).ok_or(AppError::Unauthorized)?;
    let key = api_key::resolve(pool, token)
        .await?
        .ok_or(AppError::Unauthorized)?;
    let user = user::find_by_id(pool, key.user_id).await?.ok_or_else(|| {
        tracing::warn!(user_id = %key.user_id, "api key referenced deleted user");
        AppError::Unauthorized
    })?;
    // Rate-limited to one write per key per five minutes inside the helper.
    api_key::touch_last_used(pool, key.id).await?;
    Ok(McpPrincipal {
        user,
        key_id: key.id,
        scopes: key.scopes,
    })
}

#[cfg(test)]
mod tests {
    use super::{constant_time_eq, presented_key};
    use axum::http::{HeaderMap, HeaderValue, header};

    #[test]
    fn constant_time_eq_matches_only_identical_slices() {
        assert!(constant_time_eq(b"secret-token", b"secret-token"));
        assert!(!constant_time_eq(b"secret-token", b"secret-toker"));
        assert!(!constant_time_eq(b"secret-token", b"secret-token-longer"));
        assert!(!constant_time_eq(b"", b"x"));
        assert!(constant_time_eq(b"", b""));
    }

    #[test]
    fn bearer_wins_over_the_fallback_header() {
        let mut h = HeaderMap::new();
        h.insert(
            header::AUTHORIZATION,
            HeaderValue::from_static("Bearer aaa"),
        );
        h.insert("x-api-key", HeaderValue::from_static("bbb"));
        assert_eq!(presented_key(&h), Some("aaa"));
    }

    #[test]
    fn fallback_header_is_used_when_authorization_is_absent_or_unusable() {
        let mut h = HeaderMap::new();
        h.insert("x-api-key", HeaderValue::from_static("bbb"));
        assert_eq!(presented_key(&h), Some("bbb"));

        // A non-Bearer scheme must not be mistaken for a key.
        h.insert(header::AUTHORIZATION, HeaderValue::from_static("Basic zzz"));
        assert_eq!(presented_key(&h), Some("bbb"));
    }

    #[test]
    fn empty_and_missing_credentials_are_none() {
        assert_eq!(presented_key(&HeaderMap::new()), None);
        let mut h = HeaderMap::new();
        h.insert(header::AUTHORIZATION, HeaderValue::from_static("Bearer  "));
        assert_eq!(presented_key(&h), None);
    }
}

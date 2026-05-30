//! Authentication primitives.

pub mod local;
pub mod oidc;
pub mod sessions;
pub mod user;

use crate::error::{AppError, AppResult};
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

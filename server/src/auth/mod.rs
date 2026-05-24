//! Authentication primitives.

pub mod local;
pub mod oidc;
pub mod sessions;
pub mod user;

use crate::error::{AppError, AppResult};
use tower_sessions::Session;
use uuid::Uuid;

/// Pull the authenticated user id from the session, or `Unauthorized`.
pub async fn require_user(session: &Session) -> AppResult<Uuid> {
    session
        .get::<Uuid>("user_id")
        .await?
        .ok_or(AppError::Unauthorized)
}

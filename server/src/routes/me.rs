//! `/api/me` — return the currently signed-in user (or `authenticated: false`).

use crate::auth::user::{self, PublicUser};
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use axum::{Json, Router, extract::State, routing::get};
use serde::Serialize;
use tower_sessions::Session;
use uuid::Uuid;

#[derive(Serialize)]
#[serde(untagged)]
enum MeResponse {
    Anonymous { authenticated: bool },
    Authenticated { authenticated: bool, user: PublicUser },
}

async fn me(State(state): State<AppState>, session: Session) -> AppResult<Json<MeResponse>> {
    let user_id: Option<Uuid> = session.get("user_id").await?;

    let Some(user_id) = user_id else {
        return Ok(Json(MeResponse::Anonymous {
            authenticated: false,
        }));
    };

    match user::find_by_id(&state.pool, user_id).await? {
        Some(u) => Ok(Json(MeResponse::Authenticated {
            authenticated: true,
            user: u.into(),
        })),
        None => {
            // Session points at a vanished user — purge so we don't keep
            // sending the dangling reference back.
            session.flush().await?;
            tracing::warn!(user_id = %user_id, "session referenced deleted user; purged");
            Err(AppError::Unauthorized)
        }
    }
}

pub fn router() -> Router<AppState> {
    Router::new().route("/me", get(me))
}

//! API-key management + the MCP activity trail (owner-only, session-gated).
//!
//! * `GET    /api/mcp/status` — is the MCP endpoint open, and which scopes
//!   exist (so the SPA and the server can't drift on the scope list).
//! * `GET    /api/me/api-keys` — this user's live keys, secrets omitted.
//! * `POST   /api/me/api-keys` — mint one. The **only** response that ever
//!   contains the secret.
//! * `DELETE /api/me/api-keys/{id}` — revoke one.
//! * `GET    /api/me/mcp/activity` — what agents did with those keys.
//!
//! Deliberately session-only: an API key cannot mint or revoke another API
//! key. Otherwise a single leaked read-only key would be a foothold for
//! escalating to a read-write one.

use axum::{
    Json, Router,
    extract::{Path, State},
    http::StatusCode,
    routing::{delete, get},
};
use serde::{Deserialize, Serialize};
use tower_sessions::Session;
use uuid::Uuid;

use crate::auth;
use crate::domain::{api_key, settings};
use crate::error::{AppError, AppResult};
use crate::state::AppState;

#[derive(Serialize)]
struct McpStatus {
    /// Whether an admin has left the endpoint open (default: yes).
    enabled: bool,
    /// The MCP endpoint path, so the SPA can render a copy-paste URL without
    /// hardcoding it.
    endpoint: String,
    /// Every scope a key may carry, in canonical order. The SPA renders its
    /// own labels; these are the wire ids.
    scopes: Vec<&'static str>,
}

async fn status(State(state): State<AppState>, session: Session) -> AppResult<Json<McpStatus>> {
    auth::require_user(&session).await?;
    Ok(Json(McpStatus {
        enabled: settings::mcp_enabled(&state.pool).await?,
        endpoint: "/mcp".to_string(),
        scopes: api_key::Scope::ALL.iter().map(|s| s.as_str()).collect(),
    }))
}

async fn list_mine(
    State(state): State<AppState>,
    session: Session,
) -> AppResult<Json<Vec<api_key::ApiKey>>> {
    let user_id = auth::require_user(&session).await?;
    Ok(Json(api_key::list_for_user(&state.pool, user_id).await?))
}

#[derive(Deserialize)]
struct NewKey {
    name: String,
    scopes: Vec<String>,
    /// Lifetime in days; absent means the key never expires. Expressed as a
    /// duration rather than a timestamp so a client with a skewed clock can't
    /// mint something already expired (or far longer-lived than it thinks).
    expires_in_days: Option<i64>,
}

#[derive(Serialize)]
struct MintedKey {
    /// The full `fck_…` token. Shown once — nothing stores it, so a user who
    /// loses it must mint a new key.
    token: String,
    key: api_key::ApiKey,
}

async fn create_mine(
    State(state): State<AppState>,
    session: Session,
    Json(input): Json<NewKey>,
) -> AppResult<(StatusCode, Json<MintedKey>)> {
    let user_id = auth::require_user(&session).await?;
    let scopes = api_key::ScopeSet::parse(&input.scopes)?;
    // Bounds-check BEFORE the arithmetic. `chrono::Duration::days` panics
    // above ~9.5e7 days and `DateTime + Duration` panics on overflow, and this
    // crate builds with `panic = "abort"` — so an unchecked value here would
    // let one authenticated request take the process down. `mint`'s own
    // MAX_LIFETIME_DAYS ceiling is the wrong place to catch it: it never runs.
    let expires_at = match input.expires_in_days {
        None => None,
        Some(days) if !(1..=api_key::MAX_LIFETIME_DAYS).contains(&days) => {
            return Err(AppError::BadRequest(
                "expires_in_days must be between 1 and 3650 (10 years)",
            ));
        }
        Some(days) => match chrono::Duration::try_days(days)
            .and_then(|d| chrono::Utc::now().checked_add_signed(d))
        {
            Some(at) => Some(at),
            // Unreachable given the range check above; still not worth an
            // `unwrap` on a value that arrived over the wire.
            None => return Err(AppError::BadRequest("expires_in_days is out of range")),
        },
    };

    let (key, token) =
        api_key::mint(&state.pool, user_id, &input.name, &scopes, expires_at).await?;
    // The scopes are worth logging (they're the grant); the token never is.
    tracing::info!(
        user_id = %user_id,
        key_id = %key.id,
        prefix = %key.prefix,
        scopes = ?key.scopes,
        "minted an API key"
    );
    Ok((StatusCode::CREATED, Json(MintedKey { token, key })))
}

async fn revoke_mine(
    State(state): State<AppState>,
    session: Session,
    Path(id): Path<Uuid>,
) -> AppResult<StatusCode> {
    let user_id = auth::require_user(&session).await?;
    api_key::revoke(&state.pool, user_id, id).await?;
    tracing::info!(user_id = %user_id, key_id = %id, "revoked an API key");
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
struct ActivityQuery {
    limit: Option<i64>,
}

async fn my_activity(
    State(state): State<AppState>,
    session: Session,
    axum::extract::Query(q): axum::extract::Query<ActivityQuery>,
) -> AppResult<Json<Vec<api_key::AuditEntry>>> {
    let user_id = auth::require_user(&session).await?;
    Ok(Json(
        api_key::recent_calls(&state.pool, user_id, q.limit.unwrap_or(50)).await?,
    ))
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/mcp/status", get(status))
        .route("/me/api-keys", get(list_mine).post(create_mine))
        .route("/me/api-keys/{id}", delete(revoke_mine))
        .route("/me/mcp/activity", get(my_activity))
}

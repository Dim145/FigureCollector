//! Authentication endpoints.
//!
//! Phase 1B (local) + Phase 1C (OIDC).

use crate::auth::{local, oidc, user};
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use axum::{
    Json, Router,
    extract::{Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Redirect, Response},
    routing::{get, post},
};
use serde::{Deserialize, Serialize};
use tower_sessions::Session;

// -----------------------------------------------------------------------------
// Local auth
// -----------------------------------------------------------------------------

#[derive(Deserialize)]
struct RegisterPayload {
    username: String,
    password: String,
    #[serde(default)]
    email: Option<String>,
    #[serde(default)]
    display_name: Option<String>,
}

#[derive(Deserialize)]
struct LoginPayload {
    username: String,
    password: String,
}

#[derive(Serialize)]
struct AuthSuccess {
    user: user::PublicUser,
}

async fn register_local(
    State(state): State<AppState>,
    session: Session,
    Json(payload): Json<RegisterPayload>,
) -> AppResult<(StatusCode, Json<AuthSuccess>)> {
    if !state.config.auth.allow_local_signup {
        return Err(AppError::FeatureDisabled("local sign-up is disabled"));
    }

    let username = payload.username.trim();
    let email = payload.email.as_deref().map(str::trim).filter(|s| !s.is_empty());
    let display_name = payload
        .display_name
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(username);

    local::validate_username(username)?;
    local::validate_password(&payload.password)?;
    local::validate_email_opt(email)?;

    let hash = local::hash_password(&payload.password)?;
    let new_user = user::create_local(&state.pool, username, email, display_name, &hash).await?;

    session.cycle_id().await?;
    session.insert("user_id", new_user.id).await?;

    tracing::info!(user_id = %new_user.id, username = %new_user.username, "user registered");

    Ok((
        StatusCode::CREATED,
        Json(AuthSuccess {
            user: new_user.into(),
        }),
    ))
}

async fn login_local(
    State(state): State<AppState>,
    session: Session,
    Json(payload): Json<LoginPayload>,
) -> AppResult<Json<AuthSuccess>> {
    let username = payload.username.trim();
    local::validate_username(username)?;

    let candidate = user::find_by_username(&state.pool, username).await?;
    let (user_record, hash) = match candidate {
        Some(u) => {
            let h = user::get_local_password_hash(&state.pool, u.id).await?;
            (Some(u), h)
        }
        None => (None, None),
    };

    let stored_hash = hash.unwrap_or_else(|| {
        String::from(
            "$argon2id$v=19$m=19456,t=2,p=1$ZHVtbXlfc2FsdF8xMjM0NTY$\
             RmKQyxRTRXMyM2u/c3uYksO+/cYUx6jrV1S/Y4WqJxA",
        )
    });

    let ok = local::verify_password(&payload.password, &stored_hash)?;
    let user_record = match (ok, user_record) {
        (true, Some(u)) => u,
        _ => return Err(AppError::InvalidCredentials),
    };

    session.cycle_id().await?;
    session.insert("user_id", user_record.id).await?;
    user::touch_last_login(&state.pool, user_record.id).await?;

    tracing::info!(user_id = %user_record.id, username = %user_record.username, "user signed in (local)");

    Ok(Json(AuthSuccess {
        user: user_record.into(),
    }))
}

async fn logout(session: Session) -> AppResult<StatusCode> {
    let user_id: Option<uuid::Uuid> = session.get("user_id").await?;
    session.flush().await?;
    if let Some(uid) = user_id {
        tracing::info!(user_id = %uid, "user signed out");
    }
    Ok(StatusCode::NO_CONTENT)
}

// -----------------------------------------------------------------------------
// OIDC
// -----------------------------------------------------------------------------

#[derive(Deserialize)]
struct OidcCallbackQuery {
    code: Option<String>,
    state: Option<String>,
    error: Option<String>,
    #[serde(rename = "error_description")]
    error_description: Option<String>,
}

async fn login_oidc_redirect(
    State(state): State<AppState>,
    Path(provider_id): Path<String>,
    session: Session,
) -> AppResult<Redirect> {
    let provider = state.oidc.get(&provider_id).ok_or(AppError::NotFound)?;

    let (url, pending) = oidc::build_auth_request(&provider, "/");
    session
        .insert(oidc::SESSION_KEY_OIDC, &pending)
        .await?;

    Ok(Redirect::to(url.as_str()))
}

async fn oidc_callback(
    State(state): State<AppState>,
    Path(provider_id): Path<String>,
    Query(q): Query<OidcCallbackQuery>,
    session: Session,
) -> AppResult<Response> {
    let provider = state.oidc.get(&provider_id).ok_or(AppError::NotFound)?;

    if let Some(err) = q.error {
        tracing::warn!(
            provider = %provider_id,
            error = %err,
            description = ?q.error_description,
            "OIDC IdP returned an error"
        );
        return Err(AppError::Unauthorized);
    }

    let code = q.code.ok_or(AppError::BadRequest("missing code"))?;
    let state_param = q.state.ok_or(AppError::BadRequest("missing state"))?;

    let pending: oidc::OidcPending = session
        .get(oidc::SESSION_KEY_OIDC)
        .await?
        .ok_or(AppError::BadRequest("no pending OIDC flow"))?;

    // Clear the pending entry whatever happens next.
    session.remove::<oidc::OidcPending>(oidc::SESSION_KEY_OIDC).await?;

    if pending.provider_id != provider_id {
        return Err(AppError::BadRequest("provider mismatch"));
    }
    if pending.csrf_state != state_param {
        return Err(AppError::BadRequest("state mismatch"));
    }

    let claims = oidc::complete_login(&provider, &state.http, &code, &pending).await?;

    let user_record = user::upsert_oauth_user(
        &state.pool,
        &provider_id,
        &claims.subject,
        claims.email.as_deref(),
        claims.name.as_deref(),
        claims.preferred_username.as_deref(),
        claims.picture.as_deref(),
    )
    .await?;

    session.cycle_id().await?;
    session.insert("user_id", user_record.id).await?;
    user::touch_last_login(&state.pool, user_record.id).await?;

    tracing::info!(
        user_id = %user_record.id,
        username = %user_record.username,
        provider = %provider_id,
        "user signed in (OIDC)"
    );

    // Send the browser back to the SPA home.
    let return_to = if pending.return_to.starts_with('/') {
        pending.return_to.clone()
    } else {
        "/".to_string()
    };

    Ok(Redirect::to(&return_to).into_response())
}

// -----------------------------------------------------------------------------
// Provider discovery for the SPA
// -----------------------------------------------------------------------------

#[derive(Serialize)]
struct ProvidersResponse {
    local: ProviderLocal,
    oidc: Vec<ProviderOidc>,
}

#[derive(Serialize)]
struct ProviderLocal {
    enabled: bool,
    signup_enabled: bool,
}

#[derive(Serialize)]
struct ProviderOidc {
    id: String,
    display_name: String,
}

async fn providers(State(state): State<AppState>) -> Json<ProvidersResponse> {
    Json(ProvidersResponse {
        local: ProviderLocal {
            enabled: true,
            signup_enabled: state.config.auth.allow_local_signup,
        },
        oidc: state
            .oidc
            .list()
            .into_iter()
            .map(|(id, display_name)| ProviderOidc { id, display_name })
            .collect(),
    })
}

// -----------------------------------------------------------------------------
// Router
// -----------------------------------------------------------------------------

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/auth/providers", get(providers))
        .route("/auth/register", post(register_local))
        .route("/auth/login", post(login_local))
        .route("/auth/logout", post(logout))
        .route("/auth/login/{provider}", get(login_oidc_redirect))
        .route("/auth/callback/{provider}", get(oidc_callback))
}

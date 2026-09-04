//! What stands between the network and a tool call: the admin kill-switch, the
//! per-key rate limiter, and API-key authentication.
//!
//! Order matters, and `routes::mcp::router` wires it: the flag is checked
//! first (a disabled feature costs one indexed `SELECT`, not a key lookup),
//! then the limiter — which keys on the raw header, so it can shed a flood of
//! bad credentials without resolving any of them — and only then
//! authentication.

use axum::{
    body::Body,
    extract::{Request, State},
    http::{StatusCode, header},
    middleware::Next,
    response::{IntoResponse, Response},
};
use tower_governor::key_extractor::KeyExtractor;

use crate::auth;
use crate::domain::{api_key, settings};
use crate::state::AppState;

/// Where the RFC 9728 metadata document lives, relative to the public origin.
pub const RESOURCE_METADATA_PATH: &str = "/.well-known/oauth-protected-resource";

/// A `401` that tells the client *how* to authenticate.
///
/// The MCP spec has servers return `WWW-Authenticate` on 401 so a client can
/// discover the scheme instead of showing a bare "unauthorized". We advertise
/// `Bearer` and point at our metadata document — but we are not an OAuth
/// authorization server, and the document deliberately lists no
/// `authorization_servers`, so a client can tell that a statically-issued key
/// is what's wanted.
fn unauthorized(origin: &str) -> Response {
    let origin = origin.trim_end_matches('/');
    let challenge = format!(
        "Bearer realm=\"FigureCollector\", error=\"invalid_token\", \
         error_description=\"a FigureCollector API key is required\", \
         resource_metadata=\"{origin}{RESOURCE_METADATA_PATH}\""
    );
    let body =
        Body::from(r#"{"error":"unauthorized","message":"a FigureCollector API key is required"}"#);
    let mut res = Response::new(body);
    *res.status_mut() = StatusCode::UNAUTHORIZED;
    res.headers_mut().insert(
        header::CONTENT_TYPE,
        header::HeaderValue::from_static("application/json"),
    );
    if let Ok(value) = header::HeaderValue::from_str(&challenge) {
        res.headers_mut().insert(header::WWW_AUTHENTICATE, value);
    }
    res
}

/// Refuse everything while an admin has the feature switched off.
///
/// `403 feature_disabled` rather than `404`: the endpoint's existence is
/// public (it's documented, and the SPA's settings panel links to it), so
/// hiding it would only make a misconfiguration harder to diagnose. The
/// worker-internal route's 404 pattern exists because *that* endpoint is
/// meant to be invisible; this one isn't.
pub async fn require_enabled(State(state): State<AppState>, req: Request, next: Next) -> Response {
    match settings::mcp_enabled(&state.pool).await {
        Ok(true) => next.run(req).await,
        Ok(false) => {
            crate::error::AppError::FeatureDisabled("the MCP endpoint is disabled").into_response()
        }
        Err(e) => e.into_response(),
    }
}

/// Resolve the API key and hand the principal down to the tool handlers.
///
/// rmcp copies the surviving `http::request::Parts` into the MCP request's
/// extensions, so anything inserted here is readable from a tool handler via
/// `ctx::principal`.
pub async fn authenticate(State(state): State<AppState>, mut req: Request, next: Next) -> Response {
    let principal = match auth::require_api_key(req.headers(), &state.pool).await {
        Ok(p) => p,
        Err(crate::error::AppError::Unauthorized) => {
            return unauthorized(&state.config.frontend_url);
        }
        // A DB failure is ours, not the caller's — don't dress it as a 401.
        Err(e) => return e.into_response(),
    };
    tracing::debug!(
        user_id = %principal.user.id,
        key_id = %principal.key_id,
        scopes = ?principal.scopes.to_vec(),
        "authenticated an MCP request"
    );
    req.extensions_mut().insert(principal);
    next.run(req).await
}

/// Rate-limit bucket key: the *public* prefix of the presented API key.
///
/// The IP-based extractor the rest of the app uses is wrong here — several MCP
/// clients behind one NAT (or one CGNAT carrier) would share a bucket, and a
/// single agent's retry loop would throttle everyone else. Keying on the key
/// prefix gives each credential its own budget.
///
/// Only the prefix is used, never the secret: bucket keys are held in memory
/// and are the sort of thing that ends up in a debug dump.
#[derive(Clone)]
pub struct ApiKeyBucket;

impl KeyExtractor for ApiKeyBucket {
    type Key = String;

    fn extract<B>(
        &self,
        req: &axum::http::Request<B>,
    ) -> Result<Self::Key, tower_governor::GovernorError> {
        let presented = req
            .headers()
            .get(header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("Bearer "))
            .or_else(|| req.headers().get("x-api-key").and_then(|v| v.to_str().ok()))
            .map(str::trim)
            .unwrap_or_default();

        // `fck_<prefix>_<secret>` → `fck_<prefix>`. Anything unparseable
        // (including a missing header) shares one "anonymous" bucket, which is
        // exactly what we want for credential-probing traffic.
        let bucket = presented
            .strip_prefix(api_key::TOKEN_MARKER)
            .and_then(|rest| rest.split('_').next())
            .filter(|prefix| !prefix.is_empty())
            .map(|prefix| format!("{}{prefix}", api_key::TOKEN_MARKER))
            .unwrap_or_else(|| "anonymous".to_string());
        Ok(bucket)
    }
}

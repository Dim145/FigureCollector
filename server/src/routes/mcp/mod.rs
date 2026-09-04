//! The MCP endpoint (`/mcp`) — a Model Context Protocol server over Streamable
//! HTTP, so an AI client can read the catalogue and curate one account's
//! collection.
//!
//! ## Shape
//!
//! ```text
//! POST /mcp ──▶ require_enabled ──▶ governor (per API key) ──▶ authenticate
//!                                                                   │
//!                                                    rmcp StreamableHttpService
//!                                                                   │
//!                                                            FcMcp tools
//! ```
//!
//! Mounted at the **top level**, not under `/api`, for two reasons: it isn't
//! part of the SPA's API surface, and the `/api` subtree carries a CSRF guard
//! that a bearer-authenticated endpoint has no business inheriting. The
//! trade-off is one nginx `location` (see `client/nginx.conf`), since the
//! frontend container only proxies `/api/` by default.
//!
//! ## Authentication
//!
//! Per-user API keys (`domain::api_key`), presented as
//! `Authorization: Bearer fck_…`. This deviates from the MCP spec's OAuth 2.1
//! profile, which is a "SHOULD" for HTTP transports — authorization itself is
//! OPTIONAL. The consequence is worth stating plainly: clients that let you set
//! a header (Claude Code, Claude Desktop, Cursor, VS Code) work; clients that
//! only do OAuth discovery, such as claude.ai web connectors, do not.
//!
//! No cookie is ever accepted here, which is what keeps the endpoint
//! CSRF-immune.

pub mod ctx;
pub mod dto;
pub mod guard;
pub mod prompts;
pub mod resources;
pub mod server;
pub mod tools_discover;
pub mod tools_read;
pub mod tools_write;

use std::sync::Arc;

use axum::{Json, Router, http::StatusCode, routing::get};
use rmcp::transport::streamable_http_server::{
    StreamableHttpServerConfig, StreamableHttpService, session::never::NeverSessionManager,
};
use tower_governor::{GovernorLayer, governor::GovernorConfigBuilder};

use crate::state::AppState;

/// MCP payloads are small (a JSON-RPC envelope plus arguments). Anything near
/// this is a mistake or an attack, and rejecting it early costs nothing — this
/// cap is enforced while streaming the body, independent of `Content-Length`.
const MAX_BODY_BYTES: usize = 1024 * 1024;

/// The `/mcp` router: the rmcp transport, wrapped in the kill-switch, the
/// per-key limiter and API-key authentication.
pub fn router(state: AppState) -> Router<AppState> {
    // `StreamableHttpServerConfig` is `#[non_exhaustive]`, so build from its
    // default and override deliberately — which also documents what we chose
    // to leave alone.
    let mut config = StreamableHttpServerConfig::default();
    // No protocol-level sessions. The 2026-07-28 revision removed them
    // outright, and for older clients we'd rather stay stateless than hold
    // per-connection state we don't need.
    config.legacy_session_mode = false;
    // Prefer a single JSON response; rmcp falls back to SSE by itself if a
    // handler emits a notification before the final result.
    config.json_response = true;
    // Left off deliberately: rmcp clients that negotiated below 2026-07-28
    // don't attach per-request protocol metadata, and requiring it would
    // reject every client in the field today.
    config.stateless_protocol_metadata_required = false;
    // rmcp validates `Host` to block DNS rebinding, and ships accepting
    // loopback only. Assigning the list would *replace* those defaults, which
    // silently breaks local dev, container health checks and any in-network
    // call; so extend it instead. Without the deployment's own authority in
    // here, every production request is refused with
    // "Host header is not allowed". See `config::McpConfig`.
    //
    // Matching semantics (rmcp `host_is_allowed`): an entry without a port
    // matches any port; an entry with one must match exactly.
    for host in &state.config.mcp.allowed_hosts {
        if !config.allowed_hosts.contains(host) {
            config.allowed_hosts.push(host.clone());
        }
    }
    config.allowed_origins = state.config.mcp.allowed_origins.clone();
    tracing::info!(
        hosts = ?config.allowed_hosts,
        origins = ?config.allowed_origins,
        "MCP endpoint mounted at /mcp"
    );
    config.max_request_body_bytes = MAX_BODY_BYTES;

    let mcp_state = state.clone();
    let service = StreamableHttpService::new(
        move || Ok(server::FcMcp::new(mcp_state.clone())),
        Arc::new(NeverSessionManager::default()),
        config,
    );

    // `.layer()` wraps what it's called on, so the LAST one applied is the
    // OUTERMOST. Built inside-out here, the request sees:
    //
    //     require_enabled  →  governor  →  authenticate  →  transport
    //
    // That order is deliberate. The kill-switch is first because a disabled
    // feature should cost one indexed SELECT and nothing else. The limiter
    // sits *ahead* of authentication so a flood of bad credentials is shed
    // before it can spend a key lookup each — its bucket key comes straight
    // off the raw header (`guard::ApiKeyBucket`), so it needs no resolved
    // principal to do its job.
    let mut mcp =
        Router::new()
            .route_service("/", service)
            .layer(axum::middleware::from_fn_with_state(
                state.clone(),
                guard::authenticate,
            ));

    if state.config.auth.rate_limit_enabled {
        let conf = Arc::new(
            GovernorConfigBuilder::default()
                .per_second(state.config.mcp.rate_limit_per_second)
                .burst_size(state.config.mcp.rate_limit_burst)
                .key_extractor(guard::ApiKeyBucket)
                .finish()
                .expect("valid governor configuration"),
        );
        mcp = mcp.layer(GovernorLayer::new(conf));
    }

    mcp.layer(axum::middleware::from_fn_with_state(
        state,
        guard::require_enabled,
    ))
}

/// `GET /.well-known/oauth-protected-resource` — RFC 9728 metadata.
///
/// Deliberately minimal, and deliberately **without** `authorization_servers`:
/// that field is optional in RFC 9728, and omitting it is how a client learns
/// there is no OAuth flow to attempt here — a statically-issued API key is
/// what's wanted. Serving the document at all is what turns an opaque 401 into
/// something a client can explain to its user.
pub fn well_known_router() -> Router<AppState> {
    Router::new().route(
        guard::RESOURCE_METADATA_PATH,
        get(protected_resource_metadata),
    )
}

async fn protected_resource_metadata(
    axum::extract::State(state): axum::extract::State<AppState>,
) -> (StatusCode, Json<serde_json::Value>) {
    let origin = state.config.frontend_url.trim_end_matches('/');
    (
        StatusCode::OK,
        Json(serde_json::json!({
            "resource": format!("{origin}/mcp"),
            "bearer_methods_supported": ["header"],
            "resource_name": "FigureCollector MCP",
            "resource_documentation": format!("{origin}/docs/features/mcp"),
        })),
    )
}

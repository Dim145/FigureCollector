//! Shared application state (cheaply cloneable).

use crate::auth::oidc::OidcRegistry;
use crate::cache::Cache;
use crate::config::AppConfig;
use crate::events::EventBus;
use crate::storage::Storage;
use sea_orm::DatabaseConnection;
use sqlx::PgPool;

#[derive(Clone)]
pub struct AppState {
    /// Raw sqlx pool — used by modules that still issue handwritten queries.
    pub pool: PgPool,
    /// Sea-ORM façade over the same pool; used by modules migrated to entities.
    /// Both share the underlying connections so there's no duplicate connection-pool overhead.
    pub db: DatabaseConnection,
    pub config: AppConfig,
    pub oidc: OidcRegistry,
    pub http: reqwest::Client,
    /// Same TLS + UA setup as `http` but with `redirect = Policy::none()`.
    /// Used for outbound requests whose target URL is user-controlled
    /// (webhook destinations, ntfy/apprise server URLs that the SSRF guard
    /// validated) — disabling redirects prevents a server returning a
    /// 30x → http://169.254.169.254/... from bypassing the up-front IP
    /// denylist enforced in `external::notify_channel::validate_outbound_url`.
    pub http_no_redirect: reqwest::Client,
    pub storage: Storage,
    pub events: EventBus,
    /// Pluggable cache-aside layer (in-process moka by default; see `cache`).
    pub cache: Cache,
}

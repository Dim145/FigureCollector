//! Shared application state (cheaply cloneable).

use crate::auth::oidc::OidcRegistry;
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
    pub storage: Storage,
    pub events: EventBus,
}

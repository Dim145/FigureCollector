//! Shared application state (cheaply cloneable).

use crate::auth::oidc::OidcRegistry;
use crate::config::AppConfig;
use crate::events::EventBus;
use crate::storage::Storage;
use sqlx::PgPool;

#[derive(Clone)]
pub struct AppState {
    pub pool: PgPool,
    pub config: AppConfig,
    pub oidc: OidcRegistry,
    pub http: reqwest::Client,
    pub storage: Storage,
    pub events: EventBus,
}

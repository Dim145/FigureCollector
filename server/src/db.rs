//! Database connection pool + migration runner.
//!
//! We keep a `sqlx::PgPool` as the canonical handle for runtime queries
//! (sea-orm would only be useful if we were using its entity API, which the
//! domain layer doesn't today). Migrations go through `sea-orm-migration`
//! against a wrapper around that same pool — single connection, single
//! source of truth.

use crate::config::AppConfig;
use crate::migration::Migrator;
use sea_orm::SqlxPostgresConnector;
use sea_orm_migration::MigratorTrait;
use sqlx::postgres::{PgPool, PgPoolOptions};
use std::time::Duration;

pub async fn connect_and_migrate(config: &AppConfig) -> anyhow::Result<PgPool> {
    tracing::info!("connecting to postgres…");
    let pool = PgPoolOptions::new()
        .max_connections(16)
        .min_connections(2)
        .acquire_timeout(Duration::from_secs(8))
        .connect(&config.database_url)
        .await?;

    tracing::info!("running sea-orm migrations…");
    let conn = SqlxPostgresConnector::from_sqlx_postgres_pool(pool.clone());
    Migrator::up(&conn, None).await?;
    tracing::info!("migrations applied");

    Ok(pool)
}

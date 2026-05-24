//! Database connection pool + migration runner.
//!
//! We carry both:
//!   - `sqlx::PgPool`            — for modules that still issue raw sqlx queries
//!   - `sea_orm::DatabaseConnection` — for modules that use sea-orm entities
//!
//! Both are facades over the SAME underlying sqlx pool, so there is no
//! duplicate connection bookkeeping. New code should reach for the sea-orm
//! side; legacy code can stay on raw sqlx until migrated.

use crate::config::AppConfig;
use crate::migration::Migrator;
use sea_orm::{DatabaseConnection, SqlxPostgresConnector};
use sea_orm_migration::MigratorTrait;
use sqlx::postgres::{PgPool, PgPoolOptions};
use std::time::Duration;

pub async fn connect_and_migrate(
    config: &AppConfig,
) -> anyhow::Result<(PgPool, DatabaseConnection)> {
    tracing::info!("connecting to postgres…");
    let pool = PgPoolOptions::new()
        .max_connections(16)
        .min_connections(2)
        .acquire_timeout(Duration::from_secs(8))
        .connect(&config.database_url)
        .await?;

    let db = SqlxPostgresConnector::from_sqlx_postgres_pool(pool.clone());

    tracing::info!("running sea-orm migrations…");
    Migrator::up(&db, None).await?;
    tracing::info!("migrations applied");

    Ok((pool, db))
}

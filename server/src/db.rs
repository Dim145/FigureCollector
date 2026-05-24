//! Database connection pool + migration runner.
//!
//! `sqlx::migrate!` embeds the .sql files under `./migrations` at compile time.
//! Sessions storage has its own table managed by tower-sessions-sqlx-store via
//! `PostgresStore::migrate()` (called in `auth::sessions::build`).

use crate::config::AppConfig;
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

    tracing::info!("running app migrations…");
    sqlx::migrate!("./migrations").run(&pool).await?;
    tracing::info!("migrations applied");

    Ok(pool)
}

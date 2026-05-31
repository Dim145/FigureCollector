//! Session middleware — Postgres-backed via tower-sessions-sqlx-store.

use sqlx::PgPool;
use time::Duration;
use tower_sessions::{Expiry, SessionManagerLayer, cookie::SameSite};
use tower_sessions_sqlx_store::PostgresStore;

/// Build the session layer and (concurrently) ensure the session table exists.
///
/// The cookie is HttpOnly + SameSite=Lax. `cookie_secure` adds the `Secure`
/// attribute; it defaults to `true` (see `AppConfig::cookie_secure`) and is
/// only turned off via `FC_COOKIE_INSECURE=true` for plain-HTTP local dev.
pub async fn build(
    pool: &PgPool,
    cookie_secure: bool,
) -> anyhow::Result<SessionManagerLayer<PostgresStore>> {
    let store = PostgresStore::new(pool.clone());
    store.migrate().await?;
    tracing::info!("session store migrated");

    let layer = SessionManagerLayer::new(store)
        .with_name("fc_session")
        .with_http_only(true)
        .with_same_site(SameSite::Lax)
        .with_secure(cookie_secure)
        .with_expiry(Expiry::OnInactivity(Duration::days(30)));

    Ok(layer)
}

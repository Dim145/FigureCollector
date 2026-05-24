//! Session middleware — Postgres-backed via tower-sessions-sqlx-store.

use sqlx::PgPool;
use time::Duration;
use tower_sessions::{Expiry, SessionManagerLayer, cookie::SameSite};
use tower_sessions_sqlx_store::PostgresStore;

/// Build the session layer and (concurrently) ensure the session table exists.
///
/// The cookie is HttpOnly + SameSite=Lax. `with_secure(false)` keeps it usable
/// on plain HTTP during local dev — production deployments terminate TLS in
/// front (Traefik), and the reverse proxy can be configured to set Secure on
/// outgoing Set-Cookie headers.
pub async fn build(pool: &PgPool) -> anyhow::Result<SessionManagerLayer<PostgresStore>> {
    let store = PostgresStore::new(pool.clone());
    store.migrate().await?;
    tracing::info!("session store migrated");

    let layer = SessionManagerLayer::new(store)
        .with_name("fc_session")
        .with_http_only(true)
        .with_same_site(SameSite::Lax)
        .with_secure(false) // dev default; flip to true behind HTTPS
        .with_expiry(Expiry::OnInactivity(Duration::days(30)));

    Ok(layer)
}

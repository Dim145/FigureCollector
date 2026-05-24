//! Postgres-backed cache for any third-party JSON metadata.
//!
//! Key shape: `(provider, resource, key)`, e.g.
//!   ("anilist", "media", "163")
//!   ("mfc", "item", "757334")

use crate::error::AppResult;
use chrono::{DateTime, Duration, Utc};
use serde::{Serialize, de::DeserializeOwned};
use sqlx::PgPool;

pub async fn get<T: DeserializeOwned>(
    pool: &PgPool,
    provider: &str,
    resource: &str,
    key: &str,
) -> AppResult<Option<T>> {
    let row: Option<(serde_json::Value, DateTime<Utc>)> = sqlx::query_as(
        "SELECT body, expires_at FROM external_lookups
         WHERE provider = $1 AND resource = $2 AND key = $3",
    )
    .bind(provider)
    .bind(resource)
    .bind(key)
    .fetch_optional(pool)
    .await?;

    let Some((body, expires_at)) = row else {
        return Ok(None);
    };
    if expires_at <= Utc::now() {
        return Ok(None);
    }
    Ok(Some(serde_json::from_value(body).map_err(|e| {
        crate::error::AppError::Internal(anyhow::anyhow!("cache deserialize failed: {e}"))
    })?))
}

pub async fn put<T: Serialize>(
    pool: &PgPool,
    provider: &str,
    resource: &str,
    key: &str,
    value: &T,
    ttl: Duration,
) -> AppResult<()> {
    let body = serde_json::to_value(value).map_err(|e| {
        crate::error::AppError::Internal(anyhow::anyhow!("cache serialize failed: {e}"))
    })?;
    let expires_at = Utc::now() + ttl;

    sqlx::query(
        "INSERT INTO external_lookups (provider, resource, key, body, fetched_at, expires_at)
         VALUES ($1, $2, $3, $4, now(), $5)
         ON CONFLICT (provider, resource, key) DO UPDATE
            SET body = EXCLUDED.body,
                fetched_at = EXCLUDED.fetched_at,
                expires_at = EXCLUDED.expires_at",
    )
    .bind(provider)
    .bind(resource)
    .bind(key)
    .bind(&body)
    .bind(expires_at)
    .execute(pool)
    .await?;
    Ok(())
}

/// Cached fetch: hit the cache first, fall back to `fetcher` on miss/expiry.
pub async fn cached_fetch<T, F, Fut>(
    pool: &PgPool,
    provider: &str,
    resource: &str,
    key: &str,
    ttl: Duration,
    fetcher: F,
) -> AppResult<T>
where
    T: Serialize + DeserializeOwned,
    F: FnOnce() -> Fut,
    Fut: std::future::Future<Output = AppResult<T>>,
{
    if let Some(cached) = get::<T>(pool, provider, resource, key).await? {
        tracing::debug!(provider, resource, key, "external cache hit");
        return Ok(cached);
    }
    tracing::debug!(provider, resource, key, "external cache miss — fetching");
    let fresh = fetcher().await?;
    put(pool, provider, resource, key, &fresh, ttl).await?;
    Ok(fresh)
}

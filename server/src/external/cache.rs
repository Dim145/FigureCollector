//! Postgres-backed cache for any third-party JSON metadata.
//!
//! Key shape: `(provider, resource, key)`, e.g.
//!   ("anilist", "media", "163")
//!   ("mfc", "item", "757334")
//!
//! `cached_fetch` is the only entry point handlers should reach for: it
//! hits the persistent cache first, falls back to the supplied `fetcher`
//! on miss/expiry, and writes back. Crucially, it uses an **in-process
//! singleflight** layer keyed by `(provider, resource, key)` so 50
//! concurrent SPAs all asking for the same anime in the same second
//! collapse to a single upstream call — no stampede on Jikan / AniList
//! / MFC the moment a popular cache entry expires.

use crate::error::AppResult;
use chrono::{DateTime, Duration, Utc};
use serde::{Serialize, de::DeserializeOwned};
use sqlx::PgPool;
use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
use tokio::sync::broadcast;

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

// ─── Singleflight ──────────────────────────────────────────────────────────

/// In-flight cache misses, keyed by `(provider, resource, key)`.
///
/// When the first miss for a key fires the upstream call, it inserts a
/// `broadcast::Sender<()>` into this map. Concurrent callers find the
/// sender, subscribe to it, and `recv()` instead of issuing a duplicate
/// upstream request. When the originator's fetch finishes (success OR
/// failure), it broadcasts a tick and removes the entry; subscribers
/// then re-query the persistent cache.
///
/// We only need a "wake everyone" signal, not the actual value — the
/// follow-up `get()` pulls it from Postgres. This keeps the singleflight
/// generic over `T` without `Any`-style erasure.
static INFLIGHT: LazyLock<Mutex<HashMap<InflightKey, broadcast::Sender<()>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

#[derive(Hash, Eq, PartialEq, Clone)]
struct InflightKey {
    provider: String,
    resource: String,
    key: String,
}

/// Either acquire the right to fetch (Originator) or wait for the
/// concurrent fetcher to finish (Subscriber).
enum InflightSlot {
    Originator(broadcast::Sender<()>),
    Subscriber(broadcast::Receiver<()>),
}

fn join_or_lead(k: &InflightKey) -> InflightSlot {
    let mut map = INFLIGHT.lock().expect("inflight mutex poisoned");
    if let Some(tx) = map.get(k) {
        InflightSlot::Subscriber(tx.subscribe())
    } else {
        // Channel capacity = 1; we only need a single broadcast tick.
        let (tx, _rx) = broadcast::channel::<()>(1);
        map.insert(k.clone(), tx.clone());
        InflightSlot::Originator(tx)
    }
}

fn drop_inflight(k: &InflightKey) {
    let mut map = INFLIGHT.lock().expect("inflight mutex poisoned");
    map.remove(k);
}

/// Cached fetch: hit the persistent cache first, fall back to `fetcher`
/// on miss/expiry. Concurrent misses for the same key collapse to one
/// upstream call via the in-process singleflight above.
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

    let ik = InflightKey {
        provider: provider.to_string(),
        resource: resource.to_string(),
        key: key.to_string(),
    };

    match join_or_lead(&ik) {
        InflightSlot::Originator(tx) => {
            tracing::debug!(provider, resource, key, "external cache miss — fetching");
            // We are the originator. Whatever happens, wake the
            // subscribers when we're done (RAII via a guard).
            let _guard = OriginatorGuard {
                key: ik.clone(),
                tx,
            };
            let fresh = fetcher().await?;
            put(pool, provider, resource, key, &fresh, ttl).await?;
            Ok(fresh)
        }
        InflightSlot::Subscriber(mut rx) => {
            tracing::debug!(provider, resource, key, "external cache stampede coalesced");
            // Wait for the originator to either succeed or drop. Either way,
            // re-query the persistent cache: a successful originator wrote
            // a fresh row; a failed originator left the prior expired row
            // in place, in which case we fall back to fetching ourselves.
            let _ = rx.recv().await;
            if let Some(cached) = get::<T>(pool, provider, resource, key).await? {
                return Ok(cached);
            }
            // Originator failed — we need to try once. We DON'T re-enter
            // singleflight here to avoid pathological retry-loops; this
            // subscriber simply does its own upstream call.
            let fresh = (fetcher)().await?;
            put(pool, provider, resource, key, &fresh, ttl).await?;
            Ok(fresh)
        }
    }
}

/// RAII so the inflight entry is dropped + subscribers are woken even on
/// `?` early-return or panic. Without this, a failed upstream call could
/// leave the slot occupied forever.
struct OriginatorGuard {
    key: InflightKey,
    tx: broadcast::Sender<()>,
}

impl Drop for OriginatorGuard {
    fn drop(&mut self) {
        drop_inflight(&self.key);
        // It's fine if there are no subscribers — `send` returns Err in
        // that case and we don't care.
        let _ = self.tx.send(());
    }
}


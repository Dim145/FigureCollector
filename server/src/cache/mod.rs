//! Pluggable cache layer (cache-aside) behind a backend trait.
//!
//! [`CacheStore`] is the byte-level contract every backend implements; [`Cache`]
//! is the app-facing facade (JSON response caching + key helpers). The backend
//! is chosen once at startup by `CACHE_BACKEND`:
//!   - `memory` (default) — in-process moka, per-entry TTL. **Per-replica.**
//!   - `off` — no-op (caching disabled).
//!   - `redis` / `memcached` — **not yet**: add a module implementing
//!     [`CacheStore`] and one match arm in [`Cache::from_env`]; nothing else
//!     changes. A *shared* backend (Redis) is what makes the cache correct
//!     across multiple replicas — the in-process backend only caches within one
//!     process, which is fine for a single-instance deployment.
//!
//! Invalidation is key-level ([`Cache::delete`]) so it stays portable to every
//! backend: per-user keys are dropped on that user's own mutations — correct for
//! a shared backend, per-replica for the in-process one (the reason to move to
//! Redis when scaling out). Short-TTL keys (admin polling) need no explicit
//! invalidation.

mod memory;

use std::sync::Arc;
use std::time::Duration;

use axum::http::header;
use axum::response::{IntoResponse, Response};
use uuid::Uuid;

use crate::error::{AppError, AppResult};

/// Byte-level cache contract — one impl per backend (memory now; redis /
/// memcached later). Keys are opaque strings, values opaque bytes, TTL per entry.
#[async_trait::async_trait]
pub trait CacheStore: Send + Sync {
    async fn get_bytes(&self, key: &str) -> Option<Vec<u8>>;
    async fn set_bytes(&self, key: &str, value: Vec<u8>, ttl: Duration);
    async fn delete(&self, key: &str);
    /// Backend label, for logs / health.
    fn backend(&self) -> &'static str;
}

/// App-facing cache facade. Clone-cheap (an `Arc` inside) — lives in `AppState`.
#[derive(Clone)]
pub struct Cache {
    store: Arc<dyn CacheStore>,
}

impl Cache {
    /// Build the cache from the environment (`CACHE_BACKEND`, `CACHE_MAX_ENTRIES`).
    pub fn from_env() -> Self {
        let backend = std::env::var("CACHE_BACKEND")
            .unwrap_or_default()
            .trim()
            .to_lowercase();
        let store: Arc<dyn CacheStore> = match backend.as_str() {
            "" | "memory" | "in-process" | "moka" => {
                Arc::new(memory::MemoryCache::new(max_entries_from_env()))
            }
            "off" | "none" | "disabled" => Arc::new(NoopCache),
            // To add a shared backend: implement `CacheStore` in e.g. `redis.rs`
            // and enable the arm — `"redis" => Arc::new(redis::RedisCache::new(...))`.
            other => {
                tracing::warn!(
                    backend = other,
                    "unknown CACHE_BACKEND — falling back to in-process memory cache"
                );
                Arc::new(memory::MemoryCache::new(max_entries_from_env()))
            }
        };
        let cache = Self { store };
        tracing::info!(backend = cache.store.backend(), "cache backend initialised");
        cache
    }

    /// Cache-aside JSON: return the cached rendered JSON for `key`, else run
    /// `compute`, store + return its JSON. Caches the **serialised bytes** (no
    /// re-deserialisation on a hit), so the value only needs `Serialize`.
    pub async fn json_cached<T, F, Fut>(
        &self,
        key: &str,
        ttl: Duration,
        compute: F,
    ) -> AppResult<Response>
    where
        T: serde::Serialize,
        F: FnOnce() -> Fut,
        Fut: std::future::Future<Output = AppResult<T>>,
    {
        if let Some(bytes) = self.store.get_bytes(key).await {
            return Ok(json_response(bytes));
        }
        let value = compute().await?;
        let bytes = serde_json::to_vec(&value)
            .map_err(|e| AppError::Internal(anyhow::anyhow!("cache serialize failed: {e}")))?;
        self.store.set_bytes(key, bytes.clone(), ttl).await;
        Ok(json_response(bytes))
    }

    /// Drop one key.
    pub async fn delete(&self, key: &str) {
        self.store.delete(key).await;
    }

    /// Drop a user's collection-derived caches (stats, insights, price history).
    /// Call after any change to their owned items / preorders / wishlist.
    pub async fn invalidate_user_collection(&self, user_id: Uuid) {
        self.delete(&user_stats_key(user_id)).await;
        self.delete(&user_insights_key(user_id)).await;
        self.delete(&user_price_history_key(user_id)).await;
    }
}

fn max_entries_from_env() -> u64 {
    std::env::var("CACHE_MAX_ENTRIES")
        .ok()
        .and_then(|v| v.parse().ok())
        .filter(|&n| n > 0)
        .unwrap_or(10_000)
}

fn json_response(bytes: Vec<u8>) -> Response {
    ([(header::CONTENT_TYPE, "application/json")], bytes).into_response()
}

// ── Cache keys — single source of truth, so reads and invalidation agree ─────
pub fn user_stats_key(user_id: Uuid) -> String {
    format!("stats:{user_id}")
}
pub fn user_insights_key(user_id: Uuid) -> String {
    format!("insights:{user_id}")
}
pub fn user_price_history_key(user_id: Uuid) -> String {
    format!("price-history:{user_id}")
}

/// No-op backend (`CACHE_BACKEND=off`): every get misses, set/delete do nothing.
struct NoopCache;

#[async_trait::async_trait]
impl CacheStore for NoopCache {
    async fn get_bytes(&self, _key: &str) -> Option<Vec<u8>> {
        None
    }
    async fn set_bytes(&self, _key: &str, _value: Vec<u8>, _ttl: Duration) {}
    async fn delete(&self, _key: &str) {}
    fn backend(&self) -> &'static str {
        "off"
    }
}

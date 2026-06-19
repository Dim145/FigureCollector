//! In-process cache backend (moka, async). Per-entry TTL via an [`Expiry`] impl
//! that reads the TTL stored next to each value. State lives in THIS process —
//! correct for a single replica; for multiple replicas use a shared backend
//! (Redis) so invalidations and writes are seen by every instance.

use std::sync::Arc;
use std::time::{Duration, Instant};

use moka::Expiry;
use moka::future::Cache as MokaCache;

use super::CacheStore;

#[derive(Clone)]
struct Entry {
    bytes: Arc<Vec<u8>>,
    ttl: Duration,
}

/// Per-entry expiry: each entry expires `ttl` after it is created.
struct PerEntryTtl;

impl Expiry<String, Entry> for PerEntryTtl {
    fn expire_after_create(
        &self,
        _key: &String,
        value: &Entry,
        _created_at: Instant,
    ) -> Option<Duration> {
        Some(value.ttl)
    }
}

pub struct MemoryCache {
    inner: MokaCache<String, Entry>,
}

impl MemoryCache {
    pub fn new(max_entries: u64) -> Self {
        Self {
            inner: MokaCache::builder()
                .max_capacity(max_entries)
                .expire_after(PerEntryTtl)
                .build(),
        }
    }
}

#[async_trait::async_trait]
impl CacheStore for MemoryCache {
    async fn get_bytes(&self, key: &str) -> Option<Vec<u8>> {
        self.inner.get(key).await.map(|e| e.bytes.as_ref().clone())
    }

    async fn set_bytes(&self, key: &str, value: Vec<u8>, ttl: Duration) {
        self.inner
            .insert(
                key.to_string(),
                Entry {
                    bytes: Arc::new(value),
                    ttl,
                },
            )
            .await;
    }

    async fn delete(&self, key: &str) {
        self.inner.invalidate(key).await;
    }

    fn backend(&self) -> &'static str {
        "memory"
    }
}

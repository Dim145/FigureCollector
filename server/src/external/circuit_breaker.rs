//! Per-source circuit breaker for the external boutique integrations.
//!
//! orzgk and the scraping proxy occasionally rate-limit us (HTTP 403/429) or go
//! down. Hammering them then just produces a wall of slow failures and can dig
//! the rate-limit hole deeper. After `THRESHOLD` consecutive errors from one
//! source we *open* its breaker and fail its calls fast (503) for `PAUSE`; the
//! first call after the pause is a half-open trial — a success closes the
//! breaker, another failure re-opens it immediately.
//!
//! State is in-process (each server replica keeps its own view), mirroring the
//! singleflight map in [`crate::external::cache`]. Keyed by a static provider
//! name so all of a provider's endpoints (orzgk search/detail/wishlist) share
//! one counter — they share the upstream rate-limit too.
//!
//! Tunable via env:
//!   - `EXTERNAL_BREAKER_THRESHOLD`  — consecutive errors before pausing (default 5)
//!   - `EXTERNAL_BREAKER_PAUSE_SECS` — pause length in seconds (default 300)

use std::collections::HashMap;
use std::future::Future;
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};

use crate::error::AppResult;

static THRESHOLD: LazyLock<u32> = LazyLock::new(|| {
    std::env::var("EXTERNAL_BREAKER_THRESHOLD")
        .ok()
        .and_then(|v| v.parse().ok())
        .filter(|&n| n > 0)
        .unwrap_or(5)
});

static PAUSE: LazyLock<Duration> = LazyLock::new(|| {
    let secs = std::env::var("EXTERNAL_BREAKER_PAUSE_SECS")
        .ok()
        .and_then(|v| v.parse().ok())
        .filter(|&n| n > 0)
        .unwrap_or(300);
    Duration::from_secs(secs)
});

#[derive(Default)]
struct Breaker {
    consecutive_failures: u32,
    /// `Some(t)` while open: calls fail fast until `t`.
    paused_until: Option<Instant>,
    /// True for the single trial call after a pause elapses.
    half_open: bool,
}

static BREAKERS: LazyLock<Mutex<HashMap<&'static str, Breaker>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// Remaining pause for `provider`, or `None` if a call may proceed. When the
/// pause has just elapsed, flips the breaker to half-open (one trial allowed).
fn paused_remaining(provider: &'static str) -> Option<Duration> {
    let mut map = BREAKERS.lock().expect("breaker mutex poisoned");
    let b = map.entry(provider).or_default();
    if let Some(until) = b.paused_until {
        let now = Instant::now();
        if until > now {
            return Some(until - now);
        }
        // Pause elapsed → allow a single trial call (half-open).
        b.paused_until = None;
        b.half_open = true;
    }
    None
}

fn record_success(provider: &'static str) {
    let mut map = BREAKERS.lock().expect("breaker mutex poisoned");
    let b = map.entry(provider).or_default();
    b.consecutive_failures = 0;
    b.paused_until = None;
    b.half_open = false;
}

fn record_failure(provider: &'static str) {
    let mut map = BREAKERS.lock().expect("breaker mutex poisoned");
    let b = map.entry(provider).or_default();
    if b.half_open {
        // The trial after a pause failed → straight back to paused.
        b.half_open = false;
        b.paused_until = Some(Instant::now() + *PAUSE);
        return;
    }
    b.consecutive_failures = b.consecutive_failures.saturating_add(1);
    if b.consecutive_failures >= *THRESHOLD {
        b.paused_until = Some(Instant::now() + *PAUSE);
    }
}

/// Run `call` under `provider`'s breaker: while paused, fail fast with the
/// supplied 503 message (`paused_err`) instead of hitting the upstream;
/// otherwise run it and record success/failure. Any `Err` counts as a failure
/// (a rate-limit surfaces as a string of them); any `Ok` resets the counter.
pub async fn guard<F, Fut, T>(
    provider: &'static str,
    paused_err: crate::error::AppError,
    call: F,
) -> AppResult<T>
where
    F: FnOnce() -> Fut,
    Fut: Future<Output = AppResult<T>>,
{
    if let Some(remaining) = paused_remaining(provider) {
        tracing::warn!(
            provider,
            retry_in_secs = remaining.as_secs(),
            "external source paused by circuit breaker"
        );
        return Err(paused_err);
    }
    match call().await {
        Ok(v) => {
            record_success(provider);
            Ok(v)
        }
        Err(e) => {
            record_failure(provider);
            Err(e)
        }
    }
}

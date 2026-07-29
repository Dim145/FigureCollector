//! FlareSolverr client — a self-hosted Cloudflare-challenge solver, with
//! client-side clearance reuse.
//!
//! Some upstreams (orzgk, MFC) sit behind a Cloudflare "checking your browser"
//! interstitial that 403s any client that doesn't run JavaScript. FlareSolverr
//! (and API-compatible drop-ins: Byparr, Solvearr, trawl) runs a real headless
//! browser, solves the challenge, and returns the resolved HTML + the
//! `cf_clearance` cookie over a tiny JSON API.
//!
//! **Why we cache clearance ourselves.** Solving spins up a browser and costs
//! ~30s every call. FlareSolverr has a `sessions.create` API to keep a browser
//! warm and skip re-solving — but **Byparr (the Camoufox drop-in) has no
//! sessions**, it is purely stateless. So we do the reuse on our side, which
//! works with every drop-in: the first solve harvests the `cf_clearance` cookie
//! + the solver's User-Agent; later requests to the same host **replay** them on
//! a plain direct GET (no browser, ~instant) and only fall back to the solver
//! when Cloudflare challenges again (cookie expired / rotated). A burst of
//! requests to one host (wishlist pagination, price cron) thus costs one solve
//! plus cheap replays instead of one ~30s solve each.
//!
//! Cloudflare binds `cf_clearance` to (IP, User-Agent) — both are stable here
//! (same server IP, we replay the exact UA), so the replay is accepted for the
//! classic IUAM challenge. If a stricter setup rejects it, the direct GET simply
//! comes back challenged and we transparently re-solve — never worse than
//! before.
//!
//! API (all drop-ins share it): `POST {base}/v1`
//!   request  { "cmd": "request.get", "url": "<target>", "maxTimeout": <ms> }
//!   response { "status": "ok"|"error", "message": "...",
//!              "solution": { "status": <http>, "response": "<html>",
//!                            "userAgent": "...", "cookies": [ {name,value,expires} ] } }
//!
//! Calls go through the shared rustls `reqwest::Client` (no OpenSSL). The solver
//! endpoint is operator-configured (`FLARESOLVERR_URL`) and reached on a trusted
//! network — not user-controlled, so no outbound SSRF guard needed.

use crate::error::{AppError, AppResult};
use serde::{Deserialize, Deserializer, Serialize};
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

/// A replayed direct GET should return promptly once we hold a valid clearance.
const DIRECT_TIMEOUT_SECS: u64 = 30;
/// Clearance lifetime when the solver doesn't report a `cf_clearance` expiry.
/// Conservative — real cf_clearance usually lives longer.
const DEFAULT_CLEARANCE_TTL_SECS: i64 = 900;
/// Treat a clearance as stale a bit before its real expiry to avoid racing the
/// boundary mid-request.
const EXPIRY_MARGIN_SECS: i64 = 30;

#[derive(Serialize)]
struct SolveRequest<'a> {
    cmd: &'a str,
    url: &'a str,
    #[serde(rename = "maxTimeout")]
    max_timeout: u64,
}

#[derive(Deserialize)]
struct SolveResponse {
    /// "ok" on success; "error"/"warning" otherwise.
    status: String,
    #[serde(default)]
    message: String,
    solution: Option<Solution>,
}

#[derive(Deserialize)]
struct Solution {
    /// The *target's* HTTP status (not the solver's). `0` when a drop-in omits
    /// it — treated as "unknown, trust the top-level ok".
    #[serde(default)]
    status: u16,
    /// The solved HTML.
    #[serde(default)]
    response: String,
    /// The UA the solver's browser used — must be replayed verbatim for
    /// Cloudflare to accept the cf_clearance cookie.
    #[serde(default, rename = "userAgent")]
    user_agent: String,
    /// Cookies the solved browser held for the target (incl. cf_clearance).
    #[serde(default)]
    cookies: Vec<SolvedCookie>,
}

#[derive(Deserialize)]
struct SolvedCookie {
    #[serde(default)]
    name: String,
    #[serde(default)]
    value: String,
    /// Expiry as epoch seconds. Solvers send a float; be lenient (number,
    /// numeric string, null, or absent → None = session cookie).
    #[serde(default, deserialize_with = "de_expires")]
    expires: Option<i64>,
}

/// Lenient epoch-seconds parse: accept a JSON number or numeric string, map
/// anything else (null, bool, object) to None so one odd cookie can't fail the
/// whole response parse.
fn de_expires<'de, D>(d: D) -> Result<Option<i64>, D::Error>
where
    D: Deserializer<'de>,
{
    let v = serde_json::Value::deserialize(d)?;
    Ok(match v {
        serde_json::Value::Number(n) => n.as_f64().map(|f| f as i64),
        serde_json::Value::String(s) => s.trim().parse::<f64>().ok().map(|f| f as i64),
        _ => None,
    })
}

/// A harvested Cloudflare clearance we can replay on later direct requests.
#[derive(Clone, Debug)]
struct Clearance {
    /// Full `name=value; name=value` cookie header from the solved browser.
    cookie_header: String,
    /// The exact UA that obtained the clearance (must match on replay).
    user_agent: String,
    /// Unix seconds after which we consider it stale and re-solve.
    expires_at: i64,
}

/// A solver round-trip result: the HTML plus any clearance worth caching.
#[derive(Debug)]
struct Solved {
    html: String,
    clearance: Option<Clearance>,
}

/// Process-global clearance cache, keyed by target host. cf_clearance is bound
/// to (IP, UA) — it is shared browser state, so a process-wide cache is its
/// natural home. Guarded by a std Mutex held only for the map get/put, never
/// across an await.
fn cache() -> &'static Mutex<HashMap<String, Clearance>> {
    static CACHE: OnceLock<Mutex<HashMap<String, Clearance>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Serializes solver round-trips: a burst of cache-miss requests to one host
/// triggers ONE solve (the rest wait, then replay the freshly-cached
/// clearance). Held across the ~30s solve, hence a tokio async mutex.
fn solve_lock() -> &'static tokio::sync::Mutex<()> {
    static LOCK: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| tokio::sync::Mutex::new(()))
}

fn now_secs() -> i64 {
    chrono::Utc::now().timestamp()
}

fn host_of(url: &str) -> Option<String> {
    reqwest::Url::parse(url)
        .ok()
        .and_then(|u| u.host_str().map(|h| h.to_string()))
}

fn cache_get_valid(host: &str) -> Option<Clearance> {
    let map = cache().lock().ok()?;
    let c = map.get(host)?;
    (now_secs() < c.expires_at - EXPIRY_MARGIN_SECS).then(|| c.clone())
}

fn cache_put(host: &str, c: Clearance) {
    if let Ok(mut map) = cache().lock() {
        map.insert(host.to_string(), c);
    }
}

fn cache_invalidate(host: &str) {
    if let Ok(mut map) = cache().lock() {
        map.remove(host);
    }
}

/// Fetch `target_url` through a FlareSolverr-compatible solver at `endpoint`
/// (base URL, no trailing slash), returning the solved HTML for the caller to
/// parse. `max_timeout_ms` bounds how long the solver may spend on the page.
///
/// Transparently reuses a cached `cf_clearance` (direct replay) and only solves
/// when there is no valid clearance or the replay comes back challenged.
pub async fn fetch_html(
    http: &reqwest::Client,
    endpoint: &str,
    target_url: &str,
    max_timeout_ms: u64,
) -> AppResult<String> {
    let host = host_of(target_url);

    // Fast path: replay a cached clearance with a plain GET (no solver).
    if let Some(host) = host.as_deref() {
        if let Some(clr) = cache_get_valid(host) {
            match direct_fetch(http, target_url, &clr).await {
                Ok(html) => return Ok(html),
                // Challenged / transport error → clearance is stale, re-solve.
                Err(_) => cache_invalidate(host),
            }
        }
    }

    // Slow path: serialize solves so a concurrent burst collapses into one.
    let _guard = solve_lock().lock().await;

    // Another waiter may have refreshed the clearance while we queued — retry
    // the cheap replay before spending a browser solve.
    if let Some(host) = host.as_deref() {
        if let Some(clr) = cache_get_valid(host) {
            match direct_fetch(http, target_url, &clr).await {
                Ok(html) => return Ok(html),
                Err(_) => cache_invalidate(host),
            }
        }
    }

    let solved = solve(http, endpoint, target_url, max_timeout_ms).await?;
    if let (Some(host), Some(clr)) = (host.as_deref(), solved.clearance) {
        cache_put(host, clr);
    }
    Ok(solved.html)
}

/// One solver round-trip — always launches a browser and solves the challenge.
async fn solve(
    http: &reqwest::Client,
    endpoint: &str,
    target_url: &str,
    max_timeout_ms: u64,
) -> AppResult<Solved> {
    let body = SolveRequest {
        cmd: "request.get",
        url: target_url,
        max_timeout: max_timeout_ms,
    };

    // The solver may legitimately spend up to `maxTimeout` solving; give the
    // HTTP call that budget plus a margin for browser spin-up + transfer.
    let http_timeout = Duration::from_millis(max_timeout_ms) + Duration::from_secs(30);

    let resp = http
        .post(format!("{endpoint}/v1"))
        .json(&body)
        .timeout(http_timeout)
        .send()
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("flaresolverr request failed: {e}")))?;

    if !resp.status().is_success() {
        return Err(AppError::Internal(anyhow::anyhow!(
            "flaresolverr endpoint returned HTTP {}",
            resp.status()
        )));
    }

    let text = resp
        .text()
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("flaresolverr body read failed: {e}")))?;
    parse_solved(&text)
}

/// Plain GET replaying a harvested clearance. Returns `Err` (→ caller re-solves)
/// on any transport failure, a non-2xx status, or a body that still looks like a
/// Cloudflare challenge.
async fn direct_fetch(http: &reqwest::Client, url: &str, clr: &Clearance) -> AppResult<String> {
    let resp = http
        .get(url)
        .header(reqwest::header::USER_AGENT, &clr.user_agent)
        .header(reqwest::header::COOKIE, &clr.cookie_header)
        .header(reqwest::header::ACCEPT, "text/html,application/xhtml+xml")
        .header(reqwest::header::ACCEPT_LANGUAGE, "en-US,en;q=0.9,fr;q=0.8")
        // reqwest handles gzip (no brotli), so let Cloudflare gzip or send plain.
        .header(reqwest::header::ACCEPT_ENCODING, "gzip, identity")
        .timeout(Duration::from_secs(DIRECT_TIMEOUT_SECS))
        .send()
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("clearance replay failed: {e}")))?;

    if !resp.status().is_success() {
        return Err(AppError::Internal(anyhow::anyhow!(
            "clearance replay got HTTP {}",
            resp.status()
        )));
    }

    let html = resp
        .text()
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("clearance replay body read failed: {e}")))?;

    if looks_like_challenge(&html) {
        return Err(AppError::Internal(anyhow::anyhow!(
            "clearance replay still challenged"
        )));
    }
    Ok(html)
}

/// Parse + validate a `/v1` response into HTML plus a replayable clearance.
/// Split out so it is unit-testable without a live solver.
fn parse_solved(body: &str) -> AppResult<Solved> {
    let parsed: SolveResponse = serde_json::from_str(body)
        .map_err(|e| AppError::Internal(anyhow::anyhow!("flaresolverr response parse failed: {e}")))?;

    if parsed.status != "ok" {
        return Err(AppError::Internal(anyhow::anyhow!(
            "flaresolverr could not solve the challenge: {}",
            if parsed.message.is_empty() {
                parsed.status.as_str()
            } else {
                parsed.message.as_str()
            }
        )));
    }

    let solution = parsed
        .solution
        .ok_or_else(|| AppError::Internal(anyhow::anyhow!("flaresolverr ok but returned no solution")))?;

    // Reject only a *reported* non-2xx target status (0 = drop-in didn't set it).
    if solution.status != 0 && !(200..300).contains(&solution.status) {
        return Err(AppError::Internal(anyhow::anyhow!(
            "flaresolverr solved but the target returned HTTP {}",
            solution.status
        )));
    }
    if solution.response.trim().is_empty() {
        return Err(AppError::Internal(anyhow::anyhow!(
            "flaresolverr returned an empty body"
        )));
    }

    let clearance = build_clearance(&solution);
    Ok(Solved {
        html: solution.response,
        clearance,
    })
}

/// Build a replayable clearance from a solved response — only when it carries a
/// non-empty `cf_clearance` cookie AND a User-Agent (both required for the
/// replay to be accepted). Otherwise `None`: we simply won't cache, and every
/// call keeps solving (old behaviour).
fn build_clearance(sol: &Solution) -> Option<Clearance> {
    if sol.user_agent.trim().is_empty() {
        return None;
    }
    let has_clearance = sol
        .cookies
        .iter()
        .any(|c| c.name == "cf_clearance" && !c.value.is_empty());
    if !has_clearance {
        return None;
    }
    let cookie_header = sol
        .cookies
        .iter()
        .filter(|c| !c.name.is_empty() && !c.value.is_empty())
        .map(|c| format!("{}={}", c.name, c.value))
        .collect::<Vec<_>>()
        .join("; ");
    if cookie_header.is_empty() {
        return None;
    }
    let cf_expiry = sol
        .cookies
        .iter()
        .find(|c| c.name == "cf_clearance")
        .and_then(|c| c.expires)
        .filter(|&e| e > 0);
    let expires_at = cf_expiry.unwrap_or_else(|| now_secs() + DEFAULT_CLEARANCE_TTL_SECS);
    Some(Clearance {
        cookie_header,
        user_agent: sol.user_agent.clone(),
        expires_at,
    })
}

/// Heuristic: does this HTML look like a Cloudflare interstitial rather than the
/// real page? Used to decide a direct replay failed and we must re-solve.
fn looks_like_challenge(html: &str) -> bool {
    let low = html.to_lowercase();
    const MARKERS: [&str; 7] = [
        "just a moment",
        "challenge-platform",
        "cf-mitigated",
        "_cf_chl",
        "cf_chl_opt",
        "enable javascript and cookies",
        "/cdn-cgi/challenge",
    ];
    MARKERS.iter().any(|m| low.contains(m))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_html_on_ok() {
        let body = r#"{"status":"ok","message":"","solution":{"url":"https://x","status":200,"response":"<html>hi</html>","cookies":[],"userAgent":"UA"},"version":"3"}"#;
        assert_eq!(parse_solved(body).unwrap().html, "<html>hi</html>");
    }

    #[test]
    fn ok_without_target_status_is_accepted() {
        let body = r#"{"status":"ok","solution":{"response":"<html>ok</html>"}}"#;
        assert_eq!(parse_solved(body).unwrap().html, "<html>ok</html>");
    }

    #[test]
    fn error_status_is_rejected() {
        let body = r#"{"status":"error","message":"Challenge not detected!","solution":null}"#;
        let err = parse_solved(body).unwrap_err().to_string();
        assert!(err.contains("Challenge not detected"), "got: {err}");
    }

    #[test]
    fn non_2xx_target_is_rejected() {
        let body = r#"{"status":"ok","solution":{"status":404,"response":"<html>nope</html>"}}"#;
        assert!(parse_solved(body).unwrap_err().to_string().contains("404"));
    }

    #[test]
    fn empty_body_is_rejected() {
        let body = r#"{"status":"ok","solution":{"status":200,"response":"   "}}"#;
        assert!(parse_solved(body).unwrap_err().to_string().contains("empty"));
    }

    #[test]
    fn harvests_cf_clearance_and_ua() {
        let body = r#"{"status":"ok","solution":{"status":200,"response":"<html>x</html>","userAgent":"FF-UA","cookies":[{"name":"cf_clearance","value":"abc","expires":9999999999.5},{"name":"__cf_bm","value":"def"}]}}"#;
        let clr = parse_solved(body).unwrap().clearance.expect("should harvest");
        assert!(clr.cookie_header.contains("cf_clearance=abc"), "{}", clr.cookie_header);
        assert!(clr.cookie_header.contains("__cf_bm=def"), "{}", clr.cookie_header);
        assert_eq!(clr.user_agent, "FF-UA");
        assert_eq!(clr.expires_at, 9_999_999_999);
    }

    #[test]
    fn expires_as_string_is_tolerated() {
        let body = r#"{"status":"ok","solution":{"status":200,"response":"<html>x</html>","userAgent":"UA","cookies":[{"name":"cf_clearance","value":"v","expires":"1893456000"}]}}"#;
        let clr = parse_solved(body).unwrap().clearance.expect("should harvest");
        assert_eq!(clr.expires_at, 1_893_456_000);
    }

    #[test]
    fn no_clearance_without_cf_cookie() {
        // Cookies present but no cf_clearance → nothing worth replaying.
        let body = r#"{"status":"ok","solution":{"status":200,"response":"<html>x</html>","userAgent":"UA","cookies":[{"name":"other","value":"1"}]}}"#;
        assert!(parse_solved(body).unwrap().clearance.is_none());
    }

    #[test]
    fn no_clearance_without_user_agent() {
        let body = r#"{"status":"ok","solution":{"status":200,"response":"<html>x</html>","cookies":[{"name":"cf_clearance","value":"abc"}]}}"#;
        assert!(parse_solved(body).unwrap().clearance.is_none());
    }

    #[test]
    fn missing_cf_expiry_uses_default_ttl() {
        let body = r#"{"status":"ok","solution":{"status":200,"response":"<html>x</html>","userAgent":"UA","cookies":[{"name":"cf_clearance","value":"abc"}]}}"#;
        let clr = parse_solved(body).unwrap().clearance.expect("should harvest");
        // No expiry reported → far-future default (now + TTL), well beyond now.
        assert!(clr.expires_at >= now_secs() + DEFAULT_CLEARANCE_TTL_SECS - 5);
    }

    #[test]
    fn challenge_markers_detected() {
        assert!(looks_like_challenge("<title>Just a moment...</title>"));
        assert!(looks_like_challenge("<div id=\"challenge-platform\"></div>"));
        assert!(looks_like_challenge(
            "Please enable JavaScript and cookies to continue"
        ));
        assert!(!looks_like_challenge(
            "<div class=\"product-small product\">real content</div>"
        ));
    }
}

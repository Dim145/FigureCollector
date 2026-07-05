//! FlareSolverr client — a self-hosted Cloudflare-challenge solver.
//!
//! Some upstreams (orzgk, MFC) sit behind a Cloudflare "checking your browser"
//! interstitial that 403s any client that doesn't run JavaScript. FlareSolverr
//! (and API-compatible drop-ins: Byparr, Solvearr, trawl) runs a real headless
//! browser, solves the challenge, and returns the resolved HTML over a tiny
//! JSON API. We POST one `request.get` command and hand the solved HTML to the
//! existing parsers — no cookie/session plumbing needed for one-shot lookups.
//!
//! API (all drop-ins share it): `POST {base}/v1`
//!   request  { "cmd": "request.get", "url": "<target>", "maxTimeout": <ms> }
//!   response { "status": "ok"|"error", "message": "...",
//!              "solution": { "status": <http>, "response": "<html>", ... } }
//!
//! The call goes through the shared rustls `reqwest::Client` (no OpenSSL). The
//! solver endpoint is operator-configured (`FLARESOLVERR_URL`) and reached on a
//! trusted network — it is NOT user-controlled, so it doesn't need the outbound
//! SSRF guard the notification webhooks use.

use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use std::time::Duration;

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
}

/// Fetch `target_url` through a FlareSolverr-compatible solver at `endpoint`
/// (base URL, no trailing slash), returning the solved HTML for the caller to
/// parse. `max_timeout_ms` bounds how long the solver may spend on the page.
pub async fn fetch_html(
    http: &reqwest::Client,
    endpoint: &str,
    target_url: &str,
    max_timeout_ms: u64,
) -> AppResult<String> {
    let body = SolveRequest {
        cmd: "request.get",
        url: target_url,
        max_timeout: max_timeout_ms,
    };

    // The solver may legitimately spend up to `maxTimeout` solving the
    // challenge; give the HTTP call that budget plus a margin for browser
    // spin-up + response transfer. (Overrides the client's default timeout.)
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

    let parsed = parse_solution(
        &resp
            .text()
            .await
            .map_err(|e| AppError::Internal(anyhow::anyhow!("flaresolverr body read failed: {e}")))?,
    )?;
    Ok(parsed)
}

/// Pure parse + validation of a FlareSolverr `/v1` response body, split out so
/// it's unit-testable without a live solver.
fn parse_solution(body: &str) -> AppResult<String> {
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
    Ok(solution.response)
}

#[cfg(test)]
mod tests {
    use super::parse_solution;

    #[test]
    fn extracts_html_on_ok() {
        let body = r#"{"status":"ok","message":"","solution":{"url":"https://x","status":200,"response":"<html>hi</html>","cookies":[],"userAgent":"UA"},"version":"3"}"#;
        assert_eq!(parse_solution(body).unwrap(), "<html>hi</html>");
    }

    #[test]
    fn ok_without_target_status_is_accepted() {
        // A drop-in that omits solution.status still succeeds if HTML is present.
        let body = r#"{"status":"ok","solution":{"response":"<html>ok</html>"}}"#;
        assert_eq!(parse_solution(body).unwrap(), "<html>ok</html>");
    }

    #[test]
    fn error_status_is_rejected() {
        let body = r#"{"status":"error","message":"Challenge not detected!","solution":null}"#;
        let err = parse_solution(body).unwrap_err().to_string();
        assert!(err.contains("Challenge not detected"), "got: {err}");
    }

    #[test]
    fn non_2xx_target_is_rejected() {
        let body = r#"{"status":"ok","solution":{"status":404,"response":"<html>nope</html>"}}"#;
        assert!(parse_solution(body).unwrap_err().to_string().contains("404"));
    }

    #[test]
    fn empty_body_is_rejected() {
        let body = r#"{"status":"ok","solution":{"status":200,"response":"   "}}"#;
        assert!(parse_solution(body).unwrap_err().to_string().contains("empty"));
    }
}

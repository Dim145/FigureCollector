//! Shared parsing helpers used by both [`super::search`] and
//! [`super::detail`].

use super::REQUEST_TIMEOUT_SECS;
use crate::config::FlareSolverrConfig;
use crate::error::{AppError, AppResult};

/// Fetch one orzgk page's HTML. When a FlareSolverr-compatible solver is
/// configured (`fs.url`), route the GET through it so a Cloudflare challenge is
/// solved and we get real HTML back; otherwise fetch directly with a
/// browser-like UA (unchanged behaviour). Callers parse the returned HTML.
pub(super) async fn fetch_html(
    http: &reqwest::Client,
    fs: &FlareSolverrConfig,
    url: &str,
) -> AppResult<String> {
    if let Some(endpoint) = fs.url.as_deref() {
        return crate::external::flaresolverr::fetch_html(http, endpoint, url, fs.max_timeout_ms)
            .await;
    }
    let resp = http
        .get(url)
        .header(
            reqwest::header::USER_AGENT,
            // Pretend to be a regular browser — orzgk is behind Cloudflare,
            // which sometimes refuses unknown UAs. We identify FigureCollector
            // inside the UA token so server logs still see who's hitting them.
            "Mozilla/5.0 (compatible; FigureCollector/0.1; +https://github.com/Dim145/FigureCollector)",
        )
        .header(reqwest::header::ACCEPT, "text/html,application/xhtml+xml")
        .header(reqwest::header::ACCEPT_LANGUAGE, "en-US,en;q=0.9,fr;q=0.8")
        // Only gzip; reqwest has no brotli, so tell Cloudflare it can't send br.
        .header(reqwest::header::ACCEPT_ENCODING, "gzip, identity")
        .timeout(std::time::Duration::from_secs(REQUEST_TIMEOUT_SECS))
        .send()
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("orzgk fetch failed: {e}")))?;
    if !resp.status().is_success() {
        return Err(AppError::Internal(anyhow::anyhow!(
            "orzgk returned HTTP {}",
            resp.status()
        )));
    }
    resp.text()
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("orzgk body read failed: {e}")))
}

/// Collapse all whitespace runs into a single space, trim ends. Used so
/// "  €53.28  –  €133.21\n  " comes out as "€53.28 – €133.21".
pub(super) fn collapse_ws(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut prev_space = false;
    for c in s.chars() {
        if c.is_whitespace() {
            if !prev_space {
                out.push(' ');
            }
            prev_space = true;
        } else {
            out.push(c);
            prev_space = false;
        }
    }
    out.trim().to_string()
}

/// Look for "1/4", "1/6", "1/7", "1/8", "1/10", "1/12", "non-scale" in a
/// title. First match wins; case-insensitive on the "non-scale" branch.
pub(super) fn extract_scale(title: &str) -> Option<String> {
    let lower = title.to_lowercase();
    if lower.contains("non-scale") || lower.contains("non scale") {
        return Some("non-scale".into());
    }
    // 1/N up to a couple digits — handles "1/4 scale", "1/7 …", etc.
    for n in [4u8, 5, 6, 7, 8, 10, 12, 16, 24, 144] {
        let needle = format!("1/{n}");
        if title.contains(&needle) {
            return Some(needle);
        }
    }
    None
}

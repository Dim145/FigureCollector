//! Application configuration loaded from environment variables.

use std::env;

#[derive(Debug, Clone)]
pub struct AppConfig {
    pub bind_addr: String,
    pub database_url: String,
    /// Public origin the SPA is served from. Read by the OIDC bootstrap
    /// path (`OIDC_REDIRECT_BASE` falls back to this) and kept on the
    /// struct as part of the config surface even though no other code
    /// branches on it right now.
    #[allow(dead_code)]
    pub frontend_url: String,
    /// Whether the session cookie carries the `Secure` attribute. Defaults to
    /// `true`; only flips to `false` when `FC_COOKIE_INSECURE=true` so plain
    /// HTTP works during local dev. Production (behind TLS) keeps it on.
    pub cookie_secure: bool,
    pub auth: AuthConfig,
    pub tracking: TrackingConfig,
    pub proxy: ProxyConfig,
    /// Shared bearer token the indexing worker presents to fetch user-PRIVATE
    /// owned photos for appearance tagging (`/api/internal/owned-photos/{id}`).
    /// `None` → that internal route is disabled (404), so owned-photo tagging
    /// stays off until an operator sets a token on both server and worker.
    pub worker_internal_token: Option<String>,
    /// FlareSolverr-compatible Cloudflare-challenge solver for the orzgk scraper.
    pub flaresolverr: FlareSolverrConfig,
}

/// External boutique-scraping proxy. When `base_url` is set, the
/// `/api/external/proxy/*` routes forward to it; when it's `None`, those
/// routes return `feature_disabled` and the SPA hides the matching
/// lookup widgets.
///
/// The proxy is intentionally agnostic — any service that implements the
/// three documented endpoints (`/stores`, `/search`, `/product`) works.
/// See `docs/content/features/url-import.md` for the response contract.
#[derive(Debug, Clone, Default)]
pub struct ProxyConfig {
    /// Base URL (no trailing slash). Endpoints are appended (`/stores`,
    /// `/search`, `/product`). When `None`, proxy routes return
    /// `feature_disabled`.
    pub base_url: Option<String>,
    /// Optional bearer token sent in `Authorization: Bearer …` on every
    /// proxy call. Pair with a self-hosted proxy that gates its routes,
    /// or leave unset for a proxy reachable on a trusted network only.
    pub api_key: Option<String>,
    /// Wall-clock cap (seconds) on any single proxy call. The proxy may wait
    /// on slow upstream sites (Cloudflare warm-ups, paginated scrapes), so this
    /// is generous and tunable via `FIGURE_PROXY_TIMEOUT_SECS`. Default 60.
    pub timeout_secs: u64,
}

/// FlareSolverr — a self-hosted Cloudflare-challenge solver run as a sidecar.
/// When `url` is set, the orzgk scraper routes its page fetches through it
/// (`POST {url}/v1` with `cmd: request.get`), so a Cloudflare "checking your
/// browser" interstitial is solved by a real headless browser instead of
/// 403-ing our direct HTTP client. `None` → direct fetch (unchanged). Any
/// API-compatible drop-in works too (Byparr, Solvearr, trawl — same `/v1`
/// contract). Manual figure entry always works regardless.
#[derive(Debug, Clone, Default)]
pub struct FlareSolverrConfig {
    /// Solver base URL, no trailing slash (e.g. `http://flaresolverr:8191`).
    /// `None` (env `FLARESOLVERR_URL` unset) disables solver routing.
    pub url: Option<String>,
    /// `maxTimeout` (ms) the solver may spend per request — Cloudflare warm-ups
    /// plus a headless page load are slow, so this is generous. Env
    /// `FLARESOLVERR_MAX_TIMEOUT_MS`, default 60000.
    pub max_timeout_ms: u64,
}

/// Shipping-carrier API credentials. All optional — the corresponding
/// `/api/tracking/{carrier}/…` routes return `FeatureDisabled` when a key
/// is missing, and the SPA degrades to "open the carrier page" link only.
#[derive(Debug, Clone, Default)]
pub struct TrackingConfig {
    /// La Poste / Colissimo "okapi" key. Get one at developer.laposte.fr —
    /// free tier covers personal use comfortably.
    pub colissimo_key: Option<String>,
    /// DHL Express tracking API key (DHL-API-Key header).
    pub dhl_key: Option<String>,
    /// UPS OAuth2 — both client id and secret are required for the token
    /// exchange that precedes every tracking call.
    pub ups_client_id: Option<String>,
    pub ups_client_secret: Option<String>,
}

#[derive(Debug, Clone)]
pub struct AuthConfig {
    pub allow_local_signup: bool,
    /// Master switch for the auth-route rate limiter (tower_governor).
    /// `RATE_LIMIT_ENABLED=false` removes the layer entirely — handy when
    /// you front the app with your own limiter (Traefik, Cloudflare) or
    /// when the built-in one is too aggressive for your OIDC flow's
    /// request bursts.
    pub rate_limit_enabled: bool,
    pub auth_rate_limit_per_second: u64,
    pub auth_rate_limit_burst: u32,
    /// Base URL the OIDC IdP redirects to; callbacks land at `<base>/api/auth/callback/<provider>`.
    pub oidc_redirect_base: String,
    pub oidc_providers: Vec<OidcProviderConfig>,
}

#[derive(Debug, Clone)]
pub struct OidcProviderConfig {
    pub id: String,
    pub display_name: String,
    pub issuer_url: String,
    pub client_id: String,
    pub client_secret: String,
    pub scopes: Vec<String>,
}

impl AppConfig {
    pub fn from_env() -> anyhow::Result<Self> {
        let bind_addr = env::var("FC_BIND_ADDR").unwrap_or_else(|_| "0.0.0.0:3000".into());
        let database_url = env::var("DATABASE_URL").map_err(|_| {
            anyhow::anyhow!("DATABASE_URL is required (e.g. postgres://user:pass@host:5432/db)")
        })?;
        let frontend_url =
            env::var("FRONTEND_URL").unwrap_or_else(|_| "http://localhost:5173".into());

        // Session cookie `Secure`: derived from the public scheme so it's ON in
        // any HTTPS deployment (production) but OFF for plain-HTTP local dev —
        // otherwise the browser would refuse to send the cookie over http://
        // and log everyone out. An explicit FC_COOKIE_INSECURE=true/false
        // overrides the derivation.
        let cookie_secure = match env::var("FC_COOKIE_INSECURE") {
            Ok(v) => v.trim().to_lowercase() != "true",
            Err(_) => frontend_url.starts_with("https://"),
        };

        // OIDC redirect base defaults to FRONTEND_URL (which goes through the nginx
        // reverse proxy and lands on the backend via /api/*).
        let oidc_redirect_base =
            env::var("OIDC_REDIRECT_BASE").unwrap_or_else(|_| frontend_url.clone());

        let oidc_providers = collect_oidc_providers();

        let auth = AuthConfig {
            allow_local_signup: env::var("ALLOW_LOCAL_SIGNUP")
                .map(|v| matches!(v.as_str(), "1" | "true" | "yes"))
                .unwrap_or(true),
            // Default ON. Any of false/0/no disables it.
            rate_limit_enabled: env::var("RATE_LIMIT_ENABLED")
                .map(|v| !matches!(v.trim().to_lowercase().as_str(), "0" | "false" | "no" | "off"))
                .unwrap_or(true),
            auth_rate_limit_per_second: env::var("AUTH_RATE_LIMIT_PER_SECOND")
                .ok()
                .and_then(|v| v.parse().ok())
                .filter(|&n| n > 0)
                .unwrap_or(2),
            auth_rate_limit_burst: env::var("AUTH_RATE_LIMIT_BURST")
                .ok()
                .and_then(|v| v.parse().ok())
                .filter(|&n| n > 0)
                .unwrap_or(8),
            oidc_redirect_base,
            oidc_providers,
        };

        let tracking = TrackingConfig {
            colissimo_key: env_nonempty("COLISSIMO_API_KEY"),
            dhl_key: env_nonempty("DHL_API_KEY"),
            ups_client_id: env_nonempty("UPS_CLIENT_ID"),
            ups_client_secret: env_nonempty("UPS_CLIENT_SECRET"),
        };

        // Strip a trailing slash so endpoint joining (`base + "/stores"`)
        // doesn't accidentally produce `//stores` on a misconfigured value.
        let proxy = ProxyConfig {
            base_url: env_nonempty("FIGURE_PROXY_URL")
                .map(|s| s.trim_end_matches('/').to_string()),
            api_key: env_nonempty("FIGURE_PROXY_API_KEY"),
            timeout_secs: env::var("FIGURE_PROXY_TIMEOUT_SECS")
                .ok()
                .and_then(|v| v.parse().ok())
                .filter(|&n| n > 0)
                .unwrap_or(60),
        };

        let flaresolverr = FlareSolverrConfig {
            url: env_nonempty("FLARESOLVERR_URL").map(|s| s.trim_end_matches('/').to_string()),
            max_timeout_ms: env::var("FLARESOLVERR_MAX_TIMEOUT_MS")
                .ok()
                .and_then(|v| v.parse().ok())
                .filter(|&n| n > 0)
                .unwrap_or(60_000),
        };

        Ok(Self {
            bind_addr,
            database_url,
            frontend_url,
            cookie_secure,
            auth,
            tracking,
            proxy,
            worker_internal_token: env_nonempty("WORKER_INTERNAL_TOKEN"),
            flaresolverr,
        })
    }
}

/// Treat empty / unset env vars uniformly as `None`. The compose stack often
/// expands missing variables to "" which would otherwise look like a valid
/// (but unusable) key.
fn env_nonempty(name: &str) -> Option<String> {
    match env::var(name) {
        Ok(v) if !v.trim().is_empty() => Some(v),
        _ => None,
    }
}

/// Scan well-known env-var patterns and produce a list of configured providers.
///
/// Supported today: `google` and `generic`. Both share the same shape:
///   OIDC_<PROVIDER>_CLIENT_ID
///   OIDC_<PROVIDER>_CLIENT_SECRET
///   OIDC_<PROVIDER>_ISSUER_URL       (defaults to `https://accounts.google.com` for google)
///   OIDC_<PROVIDER>_DISPLAY_NAME      (defaults to a sensible label)
///   OIDC_<PROVIDER>_SCOPES            (comma-separated; defaults to "openid,email,profile")
fn collect_oidc_providers() -> Vec<OidcProviderConfig> {
    let mut out = Vec::new();

    if let (Some(client_id), Some(client_secret)) = (
        non_empty_var("OIDC_GOOGLE_CLIENT_ID"),
        non_empty_var("OIDC_GOOGLE_CLIENT_SECRET"),
    ) {
        out.push(OidcProviderConfig {
            id: "google".into(),
            display_name: non_empty_var("OIDC_GOOGLE_DISPLAY_NAME").unwrap_or_else(|| "Google".into()),
            issuer_url: non_empty_var("OIDC_GOOGLE_ISSUER_URL")
                .unwrap_or_else(|| "https://accounts.google.com".into()),
            client_id,
            client_secret,
            scopes: parse_scopes("OIDC_GOOGLE_SCOPES", "openid,email,profile"),
        });
    }

    if let (Some(client_id), Some(client_secret), Some(issuer_url)) = (
        non_empty_var("OIDC_GENERIC_CLIENT_ID"),
        non_empty_var("OIDC_GENERIC_CLIENT_SECRET"),
        non_empty_var("OIDC_GENERIC_ISSUER_URL"),
    ) {
        out.push(OidcProviderConfig {
            id: "generic".into(),
            display_name: non_empty_var("OIDC_GENERIC_DISPLAY_NAME")
                .unwrap_or_else(|| "Single sign-on".into()),
            issuer_url,
            client_id,
            client_secret,
            scopes: parse_scopes("OIDC_GENERIC_SCOPES", "openid,email,profile"),
        });
    }

    out
}

/// `env::var` but treats empty strings (a common Compose substitution outcome
/// for `${VAR:-}`) as if the variable were unset.
fn non_empty_var(name: &str) -> Option<String> {
    match env::var(name) {
        Ok(v) if !v.trim().is_empty() => Some(v),
        _ => None,
    }
}

fn parse_scopes(env_var: &str, default: &str) -> Vec<String> {
    env::var(env_var)
        .unwrap_or_else(|_| default.to_string())
        .split(',')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect()
}

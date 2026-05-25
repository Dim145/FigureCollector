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
    pub auth: AuthConfig,
    pub tracking: TrackingConfig,
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

        // OIDC redirect base defaults to FRONTEND_URL (which goes through the nginx
        // reverse proxy and lands on the backend via /api/*).
        let oidc_redirect_base =
            env::var("OIDC_REDIRECT_BASE").unwrap_or_else(|_| frontend_url.clone());

        let oidc_providers = collect_oidc_providers();

        let auth = AuthConfig {
            allow_local_signup: env::var("ALLOW_LOCAL_SIGNUP")
                .map(|v| matches!(v.as_str(), "1" | "true" | "yes"))
                .unwrap_or(true),
            auth_rate_limit_per_second: env::var("AUTH_RATE_LIMIT_PER_SECOND")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(2),
            auth_rate_limit_burst: env::var("AUTH_RATE_LIMIT_BURST")
                .ok()
                .and_then(|v| v.parse().ok())
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

        Ok(Self {
            bind_addr,
            database_url,
            frontend_url,
            auth,
            tracking,
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

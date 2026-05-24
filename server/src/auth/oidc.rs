//! OpenID Connect — Phase 1C.
//!
//! Provider registry + auth flow helpers. Supports Google and a single
//! generic IdP (Authelia, Authentik, Keycloak…) configured via env vars.

use crate::config::OidcProviderConfig;
use crate::error::{AppError, AppResult};
use anyhow::{Context, anyhow};
use openidconnect::{
    AuthorizationCode, ClientId, ClientSecret, CsrfToken, EmptyAdditionalClaims, IssuerUrl, Nonce,
    PkceCodeChallenge, PkceCodeVerifier, RedirectUrl, Scope, TokenResponse,
    core::{CoreAuthenticationFlow, CoreClient, CoreProviderMetadata},
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use url::Url;

/// One configured OIDC provider, ready to be driven.
pub struct OidcProvider {
    pub id: String,
    pub display_name: String,
    pub client: CoreClient<
        openidconnect::EndpointSet,
        openidconnect::EndpointNotSet,
        openidconnect::EndpointNotSet,
        openidconnect::EndpointNotSet,
        openidconnect::EndpointMaybeSet,
        openidconnect::EndpointMaybeSet,
    >,
    pub scopes: Vec<String>,
}

/// All configured providers, keyed by id ("google", "generic").
#[derive(Clone, Default)]
pub struct OidcRegistry {
    providers: Arc<HashMap<String, Arc<OidcProvider>>>,
}

impl OidcRegistry {
    /// Build the registry by discovering each provider's metadata.
    ///
    /// If discovery fails for a provider we log and skip it — the server still
    /// boots, and the user gets a clear "provider not enabled" 404 on login.
    pub async fn build(
        configs: &[OidcProviderConfig],
        redirect_base: &str,
        http_client: &reqwest::Client,
    ) -> Self {
        let mut providers = HashMap::new();

        for cfg in configs {
            match Self::build_one(cfg, redirect_base, http_client).await {
                Ok(provider) => {
                    tracing::info!(
                        id = %cfg.id,
                        issuer = %cfg.issuer_url,
                        "OIDC provider registered"
                    );
                    providers.insert(cfg.id.clone(), Arc::new(provider));
                }
                Err(e) => {
                    tracing::error!(
                        id = %cfg.id,
                        issuer = %cfg.issuer_url,
                        error = %e,
                        "OIDC provider discovery failed — skipping"
                    );
                }
            }
        }

        Self {
            providers: Arc::new(providers),
        }
    }

    async fn build_one(
        cfg: &OidcProviderConfig,
        redirect_base: &str,
        http_client: &reqwest::Client,
    ) -> anyhow::Result<OidcProvider> {
        let issuer = IssuerUrl::new(cfg.issuer_url.clone())
            .with_context(|| format!("invalid issuer URL: {}", cfg.issuer_url))?;

        let metadata = CoreProviderMetadata::discover_async(issuer, http_client)
            .await
            .with_context(|| format!("OIDC discovery failed for {}", cfg.id))?;

        let redirect_url = format!(
            "{}/api/auth/callback/{}",
            redirect_base.trim_end_matches('/'),
            cfg.id
        );

        let client = CoreClient::from_provider_metadata(
            metadata,
            ClientId::new(cfg.client_id.clone()),
            Some(ClientSecret::new(cfg.client_secret.clone())),
        )
        .set_redirect_uri(
            RedirectUrl::new(redirect_url.clone())
                .with_context(|| format!("invalid redirect URL: {redirect_url}"))?,
        );

        Ok(OidcProvider {
            id: cfg.id.clone(),
            display_name: cfg.display_name.clone(),
            client,
            scopes: cfg.scopes.clone(),
        })
    }

    pub fn get(&self, id: &str) -> Option<Arc<OidcProvider>> {
        self.providers.get(id).cloned()
    }

    pub fn list(&self) -> Vec<(String, String)> {
        self.providers
            .values()
            .map(|p| (p.id.clone(), p.display_name.clone()))
            .collect()
    }
}

/// State stored in the session between the redirect to the IdP and the callback.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OidcPending {
    pub provider_id: String,
    pub csrf_state: String,
    pub nonce: String,
    pub pkce_verifier: String,
    pub return_to: String,
}

pub const SESSION_KEY_OIDC: &str = "oauth_pending";

/// Build the IdP authorization URL + a session-storage value to verify on callback.
pub fn build_auth_request(provider: &OidcProvider, return_to: &str) -> (Url, OidcPending) {
    let (pkce_challenge, pkce_verifier) = PkceCodeChallenge::new_random_sha256();

    let mut req = provider.client.authorize_url(
        CoreAuthenticationFlow::AuthorizationCode,
        CsrfToken::new_random,
        Nonce::new_random,
    );

    for scope in &provider.scopes {
        req = req.add_scope(Scope::new(scope.clone()));
    }

    let (url, csrf, nonce) = req.set_pkce_challenge(pkce_challenge).url();

    let pending = OidcPending {
        provider_id: provider.id.clone(),
        csrf_state: csrf.secret().clone(),
        nonce: nonce.secret().clone(),
        pkce_verifier: pkce_verifier.secret().clone(),
        return_to: return_to.to_string(),
    };

    (url, pending)
}

/// Exchange the authorization code for tokens and validate the id_token.
/// Returns the verified subject + email/name/picture claims.
pub async fn complete_login(
    provider: &OidcProvider,
    http_client: &reqwest::Client,
    code: &str,
    pending: &OidcPending,
) -> AppResult<OidcClaims> {
    let pkce_verifier = PkceCodeVerifier::new(pending.pkce_verifier.clone());

    let token_response = provider
        .client
        .exchange_code(AuthorizationCode::new(code.to_string()))
        .map_err(|e| AppError::Internal(anyhow!("OIDC token request build failed: {e}")))?
        .set_pkce_verifier(pkce_verifier)
        .request_async(http_client)
        .await
        .map_err(|e| AppError::Internal(anyhow!("OIDC token exchange failed: {e}")))?;

    let id_token = token_response
        .id_token()
        .ok_or_else(|| AppError::Internal(anyhow!("OIDC response missing id_token")))?;

    let id_token_verifier = provider.client.id_token_verifier();
    let nonce = Nonce::new(pending.nonce.clone());
    let claims = id_token
        .claims(&id_token_verifier, &nonce)
        .map_err(|e| AppError::Internal(anyhow!("OIDC id_token verification failed: {e}")))?;

    let subject = claims.subject().to_string();
    let email = claims.email().map(|e| e.as_str().to_string());
    let name = claims
        .name()
        .and_then(|n| n.get(None).or_else(|| n.iter().next().map(|(_, v)| v)))
        .map(|n| n.as_str().to_string());
    let picture = claims
        .picture()
        .and_then(|p| p.get(None).or_else(|| p.iter().next().map(|(_, v)| v)))
        .map(|p| p.as_str().to_string());
    let preferred_username = claims.preferred_username().map(|u| u.to_string());

    Ok(OidcClaims {
        subject,
        email,
        name,
        picture,
        preferred_username,
    })
}

#[derive(Debug, Clone)]
pub struct OidcClaims {
    pub subject: String,
    pub email: Option<String>,
    pub name: Option<String>,
    pub picture: Option<String>,
    pub preferred_username: Option<String>,
}

/// Hint for `_additional_claims` if we ever need them.
#[allow(dead_code)]
type _Claims = EmptyAdditionalClaims;

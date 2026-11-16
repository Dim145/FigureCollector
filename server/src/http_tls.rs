//! Outbound-HTTP plumbing shared by every reqwest client.
//!
//! **Root certificates.** The runtime image is `FROM scratch`: there is no
//! `/etc/ssl/certs`, so reqwest 0.13's default (the platform verifier, which
//! reads the system store) would reject every HTTPS peer. Each client is built
//! with [`webpki_roots`] instead — Mozilla's root program compiled into the
//! binary — so certificate checks work the same in the container and on a dev
//! machine.
//!
//! **OIDC.** `openidconnect` 4 only ships an HTTP adapter for reqwest 0.12;
//! [`OidcHttpClient`] is the same adapter for our reqwest 0.13 client, so OIDC
//! discovery and the token exchange go through the client (TLS roots, user
//! agent, timeouts, redirect policy) configured in `main`.

use std::future::Future;
use std::pin::Pin;
use std::sync::LazyLock;

/// Mozilla's root certificates as reqwest certificates, built once.
pub fn webpki_roots() -> Vec<reqwest::Certificate> {
    static ROOTS: LazyLock<Vec<reqwest::Certificate>> = LazyLock::new(|| {
        webpki_root_certs::TLS_SERVER_ROOT_CERTS
            .iter()
            .filter_map(|der| reqwest::Certificate::from_der(der.as_ref()).ok())
            .collect()
    });
    ROOTS.clone()
}

/// reqwest 0.13 client usable wherever `openidconnect` wants an
/// `AsyncHttpClient` (discovery, code exchange). Cheap to build: a
/// `reqwest::Client` is an `Arc` inside.
pub struct OidcHttpClient(pub reqwest::Client);

impl<'c> openidconnect::AsyncHttpClient<'c> for OidcHttpClient {
    type Error = openidconnect::HttpClientError<reqwest::Error>;
    type Future = Pin<
        Box<dyn Future<Output = Result<openidconnect::HttpResponse, Self::Error>> + Send + 'c>,
    >;

    fn call(&'c self, request: openidconnect::HttpRequest) -> Self::Future {
        Box::pin(async move {
            let response = self
                .0
                .execute(request.try_into().map_err(Box::new)?)
                .await
                .map_err(Box::new)?;

            let mut builder = http::Response::builder()
                .status(response.status())
                .version(response.version());
            for (name, value) in response.headers() {
                builder = builder.header(name, value);
            }
            builder
                .body(response.bytes().await.map_err(Box::new)?.to_vec())
                .map_err(openidconnect::HttpClientError::Http)
        })
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn every_webpki_root_converts() {
        let roots = super::webpki_roots();
        // Mozilla's program carries well over 100 roots; a silent conversion
        // failure would leave the client trusting nothing.
        assert!(roots.len() > 100, "only {} roots", roots.len());
        assert_eq!(roots.len(), webpki_root_certs::TLS_SERVER_ROOT_CERTS.len());
    }
}

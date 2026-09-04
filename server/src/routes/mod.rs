//! HTTP route surface.
//!
//! Composition: a single `/api` nest. Auth-sensitive routes get rate-limited.

use crate::state::AppState;
use axum::{Router, extract::DefaultBodyLimit};
use std::sync::Arc;
use tower_governor::{
    GovernorLayer, governor::GovernorConfigBuilder, key_extractor::SmartIpKeyExtractor,
};
use tower_http::limit::RequestBodyLimitLayer;

pub mod achievements;
pub mod activity;
pub mod admin;
pub mod auth;
pub mod calendar;
pub mod catalogue;
pub mod documents;
pub mod entities;
pub mod export;
pub mod external;
pub mod figure_photos;
pub mod follow;
pub mod condition_reports;
pub mod landed_cost;
pub mod figures;
pub mod gift;
pub mod health;
pub mod location;
pub mod manga;
pub mod mcp;
pub mod mcp_keys;
pub mod me;
pub mod notif_channels;
pub mod notifications;
pub mod owned;
pub mod photos;
pub mod preorders;
pub mod profile;
pub mod scans;
pub mod stats;
pub mod stores;
pub mod visual_search;
pub mod web_push;
pub mod wishlist;
pub mod ws;

pub fn build_router(state: AppState) -> Router {
    // Auth routes get an IP-keyed rate limiter unless RATE_LIMIT_ENABLED
    // is turned off. The toggle + tunables come from env (see AuthConfig):
    //   RATE_LIMIT_ENABLED         on/off (default on)
    //   AUTH_RATE_LIMIT_PER_SECOND sustained req/s per IP (default 2)
    //   AUTH_RATE_LIMIT_BURST      burst allowance (default 8)
    // Disabling is the escape hatch when you front the app with your own
    // limiter or the built-in one is too tight for your OIDC bursts.
    let auth_routes = if state.config.auth.rate_limit_enabled {
        let governor_conf = Arc::new(
            GovernorConfigBuilder::default()
                .per_second(state.config.auth.auth_rate_limit_per_second)
                .burst_size(state.config.auth.auth_rate_limit_burst)
                .key_extractor(SmartIpKeyExtractor)
                .finish()
                .expect("valid governor configuration"),
        );
        // tower_governor 0.8 made GovernorLayer's fields private; use the
        // `new` constructor (Arc is built via the Into bound).
        auth::router().layer(GovernorLayer::new(governor_conf))
    } else {
        tracing::warn!(
            "auth rate limiting is DISABLED (RATE_LIMIT_ENABLED=false) — \
             ensure an upstream limiter protects /api/auth/*"
        );
        auth::router()
    };

    // Public gift-list routes (`/api/g/{token}`, `…/reserve`, `…/release`) are
    // anonymous and abuse-prone (reservation spam, token probing), so they get
    // their own IP-keyed limiter, gated by the same RATE_LIMIT_ENABLED toggle.
    // We reuse the auth tunables for the sustained rate but allow a slightly
    // larger burst (10) since loading a list fans out a couple of GETs.
    let gift_routes = if state.config.auth.rate_limit_enabled {
        let gift_conf = Arc::new(
            GovernorConfigBuilder::default()
                .per_second(state.config.auth.auth_rate_limit_per_second)
                .burst_size(10)
                .key_extractor(SmartIpKeyExtractor)
                .finish()
                .expect("valid governor configuration"),
        );
        gift::router().layer(GovernorLayer::new(gift_conf))
    } else {
        gift::router()
    };

    // Public vitrine (display-cabinet) view (`/api/v/{token}`) is anonymous and
    // abuse-prone (token probing), so it gets the same IP-keyed limiter as the
    // gift routes, gated by the same RATE_LIMIT_ENABLED toggle.
    let vitrine_routes = if state.config.auth.rate_limit_enabled {
        let conf = Arc::new(
            GovernorConfigBuilder::default()
                .per_second(state.config.auth.auth_rate_limit_per_second)
                .burst_size(10)
                .key_extractor(SmartIpKeyExtractor)
                .finish()
                .expect("valid governor configuration"),
        );
        location::public_router().layer(GovernorLayer::new(conf))
    } else {
        location::public_router()
    };

    // Public pre-order calendar feed (`/api/calendar/{token}/preorders.ics`) is
    // anonymous (token-only) and polled by calendar apps, so it gets the same
    // IP-keyed limiter as the gift routes.
    let calendar_feed_routes = if state.config.auth.rate_limit_enabled {
        let conf = Arc::new(
            GovernorConfigBuilder::default()
                .per_second(state.config.auth.auth_rate_limit_per_second)
                .burst_size(10)
                .key_extractor(SmartIpKeyExtractor)
                .finish()
                .expect("valid governor configuration"),
        );
        calendar::feed_router().layer(GovernorLayer::new(conf))
    } else {
        calendar::feed_router()
    };

    // API-key management (`/api/me/api-keys`) is session-gated but mints
    // credentials, so it gets the same IP-keyed limiter as the other
    // secret-handling surfaces — a stolen session shouldn't be able to spray
    // keys, and the settings panel only ever needs a handful of requests.
    let mcp_key_routes = if state.config.auth.rate_limit_enabled {
        let conf = Arc::new(
            GovernorConfigBuilder::default()
                .per_second(state.config.auth.auth_rate_limit_per_second)
                .burst_size(10)
                .key_extractor(SmartIpKeyExtractor)
                .finish()
                .expect("valid governor configuration"),
        );
        mcp_keys::router().layer(GovernorLayer::new(conf))
    } else {
        mcp_keys::router()
    };

    // Multipart photo uploads — 5 MB per file + multipart framing.
    // Both layers are needed: `DefaultBodyLimit::disable()` removes the
    // 2-MB default that axum applies to every route (otherwise the Multipart
    // extractor errors out at 2 MB regardless of RequestBodyLimitLayer);
    // `RequestBodyLimitLayer` then sets the real cap.
    let photo_routes = photos::router()
        .layer(DefaultBodyLimit::disable())
        .layer(RequestBodyLimitLayer::new(16 * 1024 * 1024));

    // Catalog-side figure photos use the same multipart pipeline as per-user
    // photos — same 16 MB cap.
    let figure_photo_routes = figure_photos::router()
        .layer(DefaultBodyLimit::disable())
        .layer(RequestBodyLimitLayer::new(16 * 1024 * 1024));

    // 360° scans bundle up to 96 frames in one POST — and, for gsplat scans,
    // optionally the original capture video so the worker can extract full-res
    // frames itself. Cap at 256 MB to fit the frames + a typical phone video.
    let scan_routes = scans::router()
        .layer(DefaultBodyLimit::disable())
        .layer(RequestBodyLimitLayer::new(256 * 1024 * 1024));

    // Proof-of-purchase documents (receipts/invoices) — 10 MB cap + framing.
    let document_routes = documents::router()
        .layer(DefaultBodyLimit::disable())
        .layer(RequestBodyLimitLayer::new(12 * 1024 * 1024));

    // Insurance dossier POST carries the inventory cover PDF + a manifest — it's
    // multipart, so it needs DefaultBodyLimit::disable() + a real cap above the
    // 2 MB default. 8 MB is ample for even a large inventory-table cover.
    let dossier_routes = export::dossier_router()
        .layer(DefaultBodyLimit::disable())
        .layer(RequestBodyLimitLayer::new(8 * 1024 * 1024));

    // Admin uploads (entity logos / cover / portrait) — 5 MB cap, single
    // file, gated by `require_admin` inside the handler.
    let admin_photo_routes = admin::photo_upload_router()
        .layer(DefaultBodyLimit::disable())
        .layer(RequestBodyLimitLayer::new(8 * 1024 * 1024));

    // External (off-device) photo-search fallback — carries a base64 image, so
    // it needs more than the 2 MB default; an 8 MB cap leaves headroom over the
    // ~1 MB downscaled payload. It also forwards to a PAID API (Google Vision),
    // so it gets a tight IP-keyed rate limit (burst 4, ~1/s sustained) as an
    // abuse/cost backstop on top of the per-search user consent. Gated by the
    // same RATE_LIMIT_ENABLED toggle as the auth limiter.
    let external_search_routes = {
        let routes = visual_search::external_router()
            .layer(DefaultBodyLimit::disable())
            .layer(RequestBodyLimitLayer::new(8 * 1024 * 1024));
        if state.config.auth.rate_limit_enabled {
            let conf = Arc::new(
                GovernorConfigBuilder::default()
                    .per_second(1)
                    .burst_size(4)
                    .key_extractor(SmartIpKeyExtractor)
                    .finish()
                    .expect("valid governor configuration"),
            );
            routes.layer(GovernorLayer::new(conf))
        } else {
            routes
        }
    };

    let api = Router::new()
        .merge(health::router())
        .merge(landed_cost::router())
        .merge(condition_reports::router())
        .merge(mcp_key_routes)
        .merge(me::router())
        .merge(ws::router())
        .merge(figures::router())
        .merge(entities::router())
        .merge(catalogue::router())
        .merge(owned::router())
        .merge(location::router())
        .merge(vitrine_routes)
        .merge(manga::router())
        .merge(wishlist::router())
        .merge(gift_routes)
        .merge(preorders::router())
        .merge(calendar::router())
        .merge(calendar_feed_routes)
        .merge(profile::router())
        .merge(follow::router())
        .merge(export::router())
        .merge(dossier_routes)
        .merge(external::router())
        .merge(activity::router())
        .merge(achievements::router())
        .merge(notifications::router())
        .merge(notif_channels::router())
        .merge(web_push::router())
        .merge(stats::router())
        .merge(stores::router())
        .merge(visual_search::router())
        .merge(external_search_routes)
        .merge(admin::router())
        .merge(photo_routes)
        .merge(figure_photo_routes)
        .merge(scan_routes)
        .merge(document_routes)
        .merge(admin_photo_routes)
        .merge(auth_routes)
        // CSRF backstop (defense-in-depth on top of SameSite=Lax): block any
        // state-changing request a browser reports as cross-site.
        .layer(axum::middleware::from_fn(csrf_fetch_metadata_guard));

    // The MCP endpoint sits OUTSIDE `/api` on purpose: it is not part of the
    // SPA's API surface, and the CSRF guard layered on `/api` above has no
    // business wrapping a bearer-only endpoint. `well_known_router` serves the
    // discovery document a 401 points clients at.
    Router::new()
        .nest("/api", api)
        .nest("/mcp", mcp::router(state.clone()))
        .merge(mcp::well_known_router())
        .with_state(state)
}

/// Fetch-Metadata CSRF guard. Refuses mutating requests (POST/PUT/PATCH/DELETE)
/// whose `Sec-Fetch-Site` is `cross-site`. Same-origin (the SPA), same-site,
/// direct navigations (`none`), and clients that omit the header are allowed —
/// SameSite=Lax remains the primary control, this is the modern backstop.
async fn csrf_fetch_metadata_guard(
    req: axum::extract::Request,
    next: axum::middleware::Next,
) -> axum::response::Response {
    use axum::http::Method;
    use axum::response::IntoResponse;

    let mutating = matches!(
        *req.method(),
        Method::POST | Method::PUT | Method::PATCH | Method::DELETE
    );
    if mutating
        && req
            .headers()
            .get("sec-fetch-site")
            .and_then(|v| v.to_str().ok())
            .is_some_and(|s| s.eq_ignore_ascii_case("cross-site"))
    {
        return crate::error::AppError::Forbidden.into_response();
    }
    next.run(req).await
}

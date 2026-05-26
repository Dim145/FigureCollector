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
pub mod entities;
pub mod external;
pub mod figure_photos;
pub mod figures;
pub mod health;
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
pub mod web_push;
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

    // 360° scans bundle up to 96 frames in one POST. Cap at 96 MB which fits
    // a typical 48-frame phone capture (≈1-2 MB / frame) with room to spare.
    let scan_routes = scans::router()
        .layer(DefaultBodyLimit::disable())
        .layer(RequestBodyLimitLayer::new(96 * 1024 * 1024));

    // Admin uploads (entity logos / cover / portrait) — 5 MB cap, single
    // file, gated by `require_admin` inside the handler.
    let admin_photo_routes = admin::photo_upload_router()
        .layer(DefaultBodyLimit::disable())
        .layer(RequestBodyLimitLayer::new(8 * 1024 * 1024));

    let api = Router::new()
        .merge(health::router())
        .merge(me::router())
        .merge(ws::router())
        .merge(figures::router())
        .merge(entities::router())
        .merge(owned::router())
        .merge(preorders::router())
        .merge(profile::router())
        .merge(external::router())
        .merge(activity::router())
        .merge(achievements::router())
        .merge(notifications::router())
        .merge(notif_channels::router())
        .merge(web_push::router())
        .merge(stats::router())
        .merge(stores::router())
        .merge(admin::router())
        .merge(photo_routes)
        .merge(figure_photo_routes)
        .merge(scan_routes)
        .merge(admin_photo_routes)
        .merge(auth_routes);

    Router::new().nest("/api", api).with_state(state)
}

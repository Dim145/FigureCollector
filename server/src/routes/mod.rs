//! HTTP route surface.
//!
//! Composition: a single `/api` nest. Auth-sensitive routes get rate-limited.

use crate::state::AppState;
use axum::Router;
use std::sync::Arc;
use tower_governor::{
    GovernorLayer, governor::GovernorConfigBuilder, key_extractor::SmartIpKeyExtractor,
};
use tower_http::limit::RequestBodyLimitLayer;

pub mod activity;
pub mod auth;
pub mod external;
pub mod figures;
pub mod health;
pub mod me;
pub mod owned;
pub mod photos;
pub mod preorders;
pub mod profile;
pub mod scans;
pub mod ws;

pub fn build_router(state: AppState) -> Router {
    let governor_conf = Arc::new(
        GovernorConfigBuilder::default()
            .per_second(state.config.auth.auth_rate_limit_per_second)
            .burst_size(state.config.auth.auth_rate_limit_burst)
            .key_extractor(SmartIpKeyExtractor)
            .finish()
            .expect("valid governor configuration"),
    );
    let auth_governor = GovernorLayer {
        config: governor_conf,
    };

    let auth_routes = auth::router().layer(auth_governor);

    // Multipart photo uploads need a generous body limit (5 MB per file +
    // multipart framing overhead).
    let photo_routes = photos::router().layer(RequestBodyLimitLayer::new(8 * 1024 * 1024));

    // 360° scans bundle up to 96 frames in one POST; cap at 64 MB so a phone
    // batching ~36 frames at 1 MB each fits comfortably.
    let scan_routes = scans::router().layer(RequestBodyLimitLayer::new(64 * 1024 * 1024));

    let api = Router::new()
        .merge(health::router())
        .merge(me::router())
        .merge(ws::router())
        .merge(figures::router())
        .merge(owned::router())
        .merge(preorders::router())
        .merge(profile::router())
        .merge(external::router())
        .merge(activity::router())
        .merge(photo_routes)
        .merge(scan_routes)
        .merge(auth_routes);

    Router::new().nest("/api", api).with_state(state)
}

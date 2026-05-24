//! `/api/health` — always-on liveness probe used by Docker HEALTHCHECK and
//! upstream proxies. Also returns the running binary version for sanity.

use crate::state::AppState;
use axum::{Json, Router, routing::get};
use serde::Serialize;

#[derive(Serialize)]
struct HealthResponse {
    status: &'static str,
    version: &'static str,
}

async fn health() -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok",
        version: env!("CARGO_PKG_VERSION"),
    })
}

pub fn router() -> Router<AppState> {
    Router::new().route("/health", get(health))
}

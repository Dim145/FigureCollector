//! Unified application error type with axum `IntoResponse` impl.

use axum::{
    Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde_json::json;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum AppError {
    #[error("internal error: {0}")]
    Internal(#[from] anyhow::Error),

    #[error("database error: {0}")]
    Db(#[from] sqlx::Error),

    #[error("orm error: {0}")]
    Orm(#[from] sea_orm::DbErr),

    #[error("session error: {0}")]
    Session(#[from] tower_sessions::session::Error),

    #[error("password hashing error: {0}")]
    PasswordHash(String),

    #[error("not found")]
    NotFound,

    #[error("not implemented (Phase 1C+)")]
    #[allow(dead_code)]
    NotImplemented,

    #[error("unauthorized")]
    Unauthorized,

    #[error("forbidden")]
    Forbidden,

    #[error("conflict: {0}")]
    Conflict(&'static str),

    #[error("bad request: {0}")]
    BadRequest(&'static str),

    #[error("invalid credentials")]
    InvalidCredentials,

    #[error("feature disabled: {0}")]
    FeatureDisabled(&'static str),

    // Bare `{0}`: the message is a deliberate, author-controlled, user-facing
    // string (e.g. a paused-source notice), surfaced verbatim by `into_response`.
    #[error("{0}")]
    ServiceUnavailable(&'static str),
}

impl AppError {
    fn status_and_code(&self) -> (StatusCode, &'static str) {
        match self {
            AppError::Internal(_) => (StatusCode::INTERNAL_SERVER_ERROR, "internal"),
            AppError::Db(_) => (StatusCode::INTERNAL_SERVER_ERROR, "db"),
            AppError::Orm(_) => (StatusCode::INTERNAL_SERVER_ERROR, "orm"),
            AppError::Session(_) => (StatusCode::INTERNAL_SERVER_ERROR, "session"),
            AppError::PasswordHash(_) => (StatusCode::INTERNAL_SERVER_ERROR, "password_hash"),
            AppError::NotFound => (StatusCode::NOT_FOUND, "not_found"),
            AppError::NotImplemented => (StatusCode::NOT_IMPLEMENTED, "not_implemented"),
            AppError::Unauthorized => (StatusCode::UNAUTHORIZED, "unauthorized"),
            AppError::Forbidden => (StatusCode::FORBIDDEN, "forbidden"),
            AppError::Conflict(_) => (StatusCode::CONFLICT, "conflict"),
            AppError::BadRequest(_) => (StatusCode::BAD_REQUEST, "bad_request"),
            AppError::InvalidCredentials => (StatusCode::UNAUTHORIZED, "invalid_credentials"),
            AppError::FeatureDisabled(_) => (StatusCode::FORBIDDEN, "feature_disabled"),
            AppError::ServiceUnavailable(_) => {
                (StatusCode::SERVICE_UNAVAILABLE, "service_unavailable")
            }
        }
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, code) = self.status_and_code();

        // 503 ServiceUnavailable is an expected, client-facing condition (a
        // source paused by the circuit breaker) carrying a safe static message —
        // don't log it as a server error, and DO surface its message. Other 5xx
        // stay opaque so internal error strings never leak to clients.
        let is_paused = matches!(self, AppError::ServiceUnavailable(_));

        if status.is_server_error() && !is_paused {
            tracing::error!(error = ?self, "request failed");
        } else {
            tracing::debug!(error = %self, status = %status, "request rejected");
        }

        let message = if !status.is_server_error() || is_paused {
            self.to_string()
        } else {
            code.to_string()
        };

        (
            status,
            Json(json!({
                "error": code,
                "message": message,
            })),
        )
            .into_response()
    }
}

pub type AppResult<T> = std::result::Result<T, AppError>;

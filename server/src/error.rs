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
        }
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, code) = self.status_and_code();

        // Log server-side errors with detail; client errors stay quiet.
        if status.is_server_error() {
            tracing::error!(error = ?self, "request failed");
        } else {
            tracing::debug!(error = %self, status = %status, "request rejected");
        }

        // Never leak internal error strings to clients.
        let message = match status.is_server_error() {
            true => code.to_string(),
            false => self.to_string(),
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

//! Local credentials — Argon2id password hashing.
//!
//! We use the OWASP-recommended Argon2id defaults (memory ≥ 19 MiB, iterations 2,
//! parallelism 1) from the `argon2` crate's `Default::default()`.

use crate::error::{AppError, AppResult};
use argon2::{
    Argon2,
    password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString, rand_core::OsRng},
};

/// Hash a plaintext password with Argon2id. Returns the PHC string (`$argon2id$…`)
/// suitable for direct storage in `local_credentials.password_hash`.
pub fn hash_password(password: &str) -> AppResult<String> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(|e| AppError::PasswordHash(e.to_string()))
}

/// Verify a plaintext password against a stored PHC hash.
/// Returns `Ok(true)` on match, `Ok(false)` on mismatch, `Err` on parse failure.
pub fn verify_password(password: &str, phc: &str) -> AppResult<bool> {
    let parsed = PasswordHash::new(phc).map_err(|e| AppError::PasswordHash(e.to_string()))?;
    match Argon2::default().verify_password(password.as_bytes(), &parsed) {
        Ok(()) => Ok(true),
        Err(argon2::password_hash::Error::Password) => Ok(false),
        Err(e) => Err(AppError::PasswordHash(e.to_string())),
    }
}

/// Lightweight input checks. Real validation happens on the frontend too;
/// this is the server-side floor.
pub fn validate_username(s: &str) -> AppResult<()> {
    if s.len() < 3 || s.len() > 32 {
        return Err(AppError::BadRequest("username must be 3–32 chars"));
    }
    if !s
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-' || c == '.')
    {
        return Err(AppError::BadRequest(
            "username may only contain a–z, 0–9, _, -, .",
        ));
    }
    Ok(())
}

pub fn validate_password(s: &str) -> AppResult<()> {
    if s.len() < 10 {
        return Err(AppError::BadRequest("password must be ≥ 10 characters"));
    }
    if s.len() > 256 {
        return Err(AppError::BadRequest("password too long (max 256)"));
    }
    Ok(())
}

pub fn validate_email_opt(s: Option<&str>) -> AppResult<()> {
    if let Some(email) = s {
        // Floor: must contain '@' with non-empty parts on either side.
        let mut split = email.splitn(2, '@');
        let local = split.next().unwrap_or("");
        let domain = split.next().unwrap_or("");
        if local.is_empty() || domain.is_empty() || !domain.contains('.') {
            return Err(AppError::BadRequest("invalid email"));
        }
    }
    Ok(())
}

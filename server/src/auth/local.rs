//! Local credentials — Argon2id password hashing.
//!
//! We use the OWASP-recommended Argon2id defaults (memory ≥ 19 MiB, iterations 2,
//! parallelism 1) from the `argon2` crate's `Default::default()`.

use crate::error::{AppError, AppResult};
use argon2::{
    Argon2,
    password_hash::{PasswordHasher, PasswordVerifier, phc::PasswordHash},
};

/// Hash a plaintext password with Argon2id. Returns the PHC string (`$argon2id$…`)
/// suitable for direct storage in `local_credentials.password_hash`. The salt
/// is drawn from the OS RNG (`getrandom`).
pub fn hash_password(password: &str) -> AppResult<String> {
    Argon2::default()
        .hash_password(password.as_bytes())
        .map(|h| h.to_string())
        .map_err(|e| AppError::PasswordHash(e.to_string()))
}

/// Verify a plaintext password against a stored PHC hash.
/// Returns `Ok(true)` on match, `Ok(false)` on mismatch, `Err` on parse failure.
pub fn verify_password(password: &str, phc: &str) -> AppResult<bool> {
    let parsed = PasswordHash::new(phc).map_err(|e| AppError::PasswordHash(e.to_string()))?;
    match Argon2::default().verify_password(password.as_bytes(), &parsed) {
        Ok(()) => Ok(true),
        Err(argon2::password_hash::Error::PasswordInvalid) => Ok(false),
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

#[cfg(test)]
mod hash_tests {
    use super::*;

    /// Produced by the argon2 0.5 / password-hash 0.5 code this module ran
    /// before the 0.6 upgrade. Every stored `local_credentials.password_hash`
    /// looks like this: it must keep verifying, or local logins break.
    const LEGACY_PHC: &str = "$argon2id$v=19$m=19456,t=2,p=1$iKT4wNpBtfBnSVAQq07luQ$smcB8wi2Hi/OnZaKfuyZxhVuGBa/6IFSyAHAX+qnYyw";

    #[test]
    fn hashes_made_before_the_upgrade_still_verify() {
        assert!(verify_password("legacy correct horse", LEGACY_PHC).unwrap());
        assert!(!verify_password("legacy wrong horse", LEGACY_PHC).unwrap());
    }

    #[test]
    fn new_hashes_round_trip_with_the_same_parameters() {
        let phc = hash_password("fresh password").unwrap();
        // Same algorithm and OWASP parameters as the stored hashes.
        assert!(phc.starts_with("$argon2id$v=19$m=19456,t=2,p=1$"), "{phc}");
        assert!(verify_password("fresh password", &phc).unwrap());
        assert!(!verify_password("other", &phc).unwrap());
        // A fresh random salt each time.
        assert_ne!(phc, hash_password("fresh password").unwrap());
    }

    #[test]
    fn a_garbled_hash_is_an_error_not_a_mismatch() {
        assert!(verify_password("x", "not-a-phc-string").is_err());
    }
}

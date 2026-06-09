//! App-wide settings — a small key/value table for admin-tunable policies.
//!
//! First setting: who may create 3D / Gaussian-splat scans. 3D training is
//! GPU-heavy, so an admin may restrict it to admins only. The value lives in
//! `app_settings`; absence means the default (admins-only).

use crate::error::AppResult;
use serde::{Deserialize, Serialize};
use sqlx::PgPool;

const GSPLAT_POLICY_KEY: &str = "gsplat.creation_policy";

/// Anyone authenticated may create a gsplat scan.
pub const POLICY_EVERYONE: &str = "everyone";
/// Only admins may create a gsplat scan.
pub const POLICY_ADMINS_ONLY: &str = "admins_only";
/// Default before an admin sets one — admins-only (gsplat is GPU-heavy).
const GSPLAT_POLICY_DEFAULT: &str = POLICY_ADMINS_ONLY;

pub fn is_valid_gsplat_policy(value: &str) -> bool {
    matches!(value, POLICY_EVERYONE | POLICY_ADMINS_ONLY)
}

/// The current "who can create gsplat scans" policy, falling back to the
/// default when unset.
pub async fn gsplat_creation_policy(pool: &PgPool) -> AppResult<String> {
    let value: Option<String> = sqlx::query_scalar("SELECT value FROM app_settings WHERE key = $1")
        .bind(GSPLAT_POLICY_KEY)
        .fetch_optional(pool)
        .await?;
    Ok(value.unwrap_or_else(|| GSPLAT_POLICY_DEFAULT.to_string()))
}

/// True when only admins may create gsplat scans (the enforcement shortcut).
pub async fn gsplat_admins_only(pool: &PgPool) -> AppResult<bool> {
    Ok(gsplat_creation_policy(pool).await? == POLICY_ADMINS_ONLY)
}

pub async fn set_gsplat_creation_policy(pool: &PgPool, policy: &str) -> AppResult<()> {
    sqlx::query(
        "INSERT INTO app_settings (key, value, updated_at)
         VALUES ($1, $2, now())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()",
    )
    .bind(GSPLAT_POLICY_KEY)
    .bind(policy)
    .execute(pool)
    .await?;
    Ok(())
}

/// The admin-facing settings view (extend as more settings are added).
#[derive(Debug, Serialize)]
pub struct Settings {
    pub gsplat_creation_policy: String,
}

#[derive(Debug, Deserialize)]
pub struct SettingsPatch {
    pub gsplat_creation_policy: Option<String>,
}

pub async fn all(pool: &PgPool) -> AppResult<Settings> {
    Ok(Settings {
        gsplat_creation_policy: gsplat_creation_policy(pool).await?,
    })
}

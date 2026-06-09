//! App-wide settings — a small key/value table for admin-tunable policies.
//!
//! - `gsplat.creation_policy`: who may create 3D / Gaussian-splat scans (3D
//!   training is GPU-heavy, so an admin may restrict it to admins only).
//! - `cote.price_cron`: 5-field cron schedule (UTC) for the price-refresh job
//!   that feeds the "cote" market value; empty disables it. See
//!   [`crate::services::price_cron`].
//!
//! Values live in `app_settings`; an absent row means the coded default.

use crate::error::AppResult;
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use std::str::FromStr as _;

const GSPLAT_POLICY_KEY: &str = "gsplat.creation_policy";

/// Anyone authenticated may create a gsplat scan.
pub const POLICY_EVERYONE: &str = "everyone";
/// Only admins may create a gsplat scan.
pub const POLICY_ADMINS_ONLY: &str = "admins_only";
/// Default before an admin sets one — admins-only (gsplat is GPU-heavy).
const GSPLAT_POLICY_DEFAULT: &str = POLICY_ADMINS_ONLY;

/// 5-field cron schedule (UTC) driving the cote price-refresh job. Empty
/// disables the feature.
const PRICE_CRON_KEY: &str = "cote.price_cron";
const PRICE_CRON_DEFAULT: &str = "";

pub fn is_valid_gsplat_policy(value: &str) -> bool {
    matches!(value, POLICY_EVERYONE | POLICY_ADMINS_ONLY)
}

/// A price-cron value is valid when empty (feature disabled) or a parseable
/// 5-field cron expression.
pub fn is_valid_price_cron(value: &str) -> bool {
    let trimmed = value.trim();
    trimmed.is_empty() || croner::Cron::from_str(trimmed).is_ok()
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

/// The cron schedule driving the price-refresh job, or `""` (disabled) when unset.
pub async fn price_cron_schedule(pool: &PgPool) -> AppResult<String> {
    let value: Option<String> = sqlx::query_scalar("SELECT value FROM app_settings WHERE key = $1")
        .bind(PRICE_CRON_KEY)
        .fetch_optional(pool)
        .await?;
    Ok(value.unwrap_or_else(|| PRICE_CRON_DEFAULT.to_string()))
}

pub async fn set_price_cron_schedule(pool: &PgPool, schedule: &str) -> AppResult<()> {
    sqlx::query(
        "INSERT INTO app_settings (key, value, updated_at)
         VALUES ($1, $2, now())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()",
    )
    .bind(PRICE_CRON_KEY)
    .bind(schedule)
    .execute(pool)
    .await?;
    Ok(())
}

/// The admin-facing settings view (extend as more settings are added).
#[derive(Debug, Serialize)]
pub struct Settings {
    pub gsplat_creation_policy: String,
    pub price_cron: String,
}

#[derive(Debug, Deserialize)]
pub struct SettingsPatch {
    pub gsplat_creation_policy: Option<String>,
    pub price_cron: Option<String>,
}

pub async fn all(pool: &PgPool) -> AppResult<Settings> {
    Ok(Settings {
        gsplat_creation_policy: gsplat_creation_policy(pool).await?,
        price_cron: price_cron_schedule(pool).await?,
    })
}

//! Admin-side queries — user management + cross-user aggregates.
//!
//! Routes that consume these MUST gate through `auth::require_admin`; the
//! domain functions here trust their caller and don't re-check the role.

use crate::auth::local;
use crate::auth::user::User;
use crate::error::{AppError, AppResult};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, PgPool};
use uuid::Uuid;

/// Row shape returned by `/admin/users` — joins on counters so the table
/// can show "how much data this user has" at a glance without N+1 fetches.
#[derive(Debug, Clone, Serialize, FromRow)]
pub struct AdminUserRow {
    pub id: Uuid,
    pub username: String,
    pub email: Option<String>,
    pub display_name: String,
    pub avatar_url: Option<String>,
    pub locale: String,
    pub is_admin: bool,
    pub created_at: DateTime<Utc>,
    pub last_login_at: Option<DateTime<Utc>>,
    pub owned_count: i64,
    pub figure_count: i64,
}

pub async fn list_users(pool: &PgPool) -> AppResult<Vec<AdminUserRow>> {
    Ok(sqlx::query_as::<_, AdminUserRow>(
        "SELECT
             u.id, u.username, u.email, u.display_name, u.avatar_url,
             u.locale, u.is_admin, u.created_at, u.last_login_at,
             COALESCE(o.cnt, 0)::bigint AS owned_count,
             COALESCE(f.cnt, 0)::bigint AS figure_count
         FROM users u
         LEFT JOIN (
             SELECT user_id, COUNT(*) AS cnt FROM owned_items GROUP BY user_id
         ) o ON o.user_id = u.id
         LEFT JOIN (
             SELECT created_by AS user_id, COUNT(*) AS cnt
             FROM figures WHERE created_by IS NOT NULL
             GROUP BY created_by
         ) f ON f.user_id = u.id
         ORDER BY u.created_at ASC",
    )
    .fetch_all(pool)
    .await?)
}

#[derive(Debug, Clone, Deserialize)]
pub struct NewAdminUser {
    pub username: String,
    pub password: String,
    pub email: Option<String>,
    pub display_name: Option<String>,
    #[serde(default)]
    pub is_admin: bool,
}

pub async fn create_user(pool: &PgPool, input: NewAdminUser) -> AppResult<User> {
    let username = input.username.trim();
    local::validate_username(username)?;
    local::validate_password(&input.password)?;
    local::validate_email_opt(input.email.as_deref())?;
    let hash = local::hash_password(&input.password)?;

    let display = input
        .display_name
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(username);

    let mut tx = pool.begin().await?;
    let user_id = Uuid::now_v7();
    let row: User = match sqlx::query_as(
        "INSERT INTO users (id, username, email, display_name, locale, is_admin)
         VALUES ($1, $2, $3, $4, 'fr', $5)
         RETURNING id, username, email, display_name, avatar_url, locale,
                   is_admin, created_at, last_login_at",
    )
    .bind(user_id)
    .bind(username)
    .bind(input.email.as_deref())
    .bind(display)
    .bind(input.is_admin)
    .fetch_one(&mut *tx)
    .await
    {
        Ok(r) => r,
        Err(sqlx::Error::Database(db)) if db.is_unique_violation() => {
            return Err(AppError::Conflict("username or email already taken"));
        }
        Err(e) => return Err(e.into()),
    };

    sqlx::query("INSERT INTO local_credentials (user_id, password_hash) VALUES ($1, $2)")
        .bind(row.id)
        .bind(&hash)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(row)
}

#[derive(Debug, Clone, Deserialize, Default)]
pub struct UserPatch {
    pub display_name: Option<String>,
    pub email: Option<String>,
    pub locale: Option<String>,
    pub is_admin: Option<bool>,
    /// Optional password reset (admin-issued). Argon2id-hashed before write.
    pub password: Option<String>,
}

pub async fn patch_user(pool: &PgPool, id: Uuid, input: UserPatch) -> AppResult<User> {
    if let Some(p) = input.password.as_ref() {
        local::validate_password(p)?;
    }
    if let Some(e) = input.email.as_deref() {
        local::validate_email_opt(Some(e))?;
    }

    let mut tx = pool.begin().await?;

    let row: Option<User> = sqlx::query_as(
        "UPDATE users SET
             display_name = COALESCE($1, display_name),
             email        = COALESCE($2, email),
             locale       = COALESCE($3, locale),
             is_admin     = COALESCE($4, is_admin)
         WHERE id = $5
         RETURNING id, username, email, display_name, avatar_url, locale,
                   is_admin, created_at, last_login_at",
    )
    .bind(input.display_name.as_deref())
    .bind(input.email.as_deref())
    .bind(input.locale.as_deref())
    .bind(input.is_admin)
    .bind(id)
    .fetch_optional(&mut *tx)
    .await?;

    let user = row.ok_or(AppError::NotFound)?;

    if let Some(p) = input.password {
        let hash = local::hash_password(&p)?;
        // Upsert local_credentials so admins can give a password to a user
        // who only has an OAuth identity.
        sqlx::query(
            "INSERT INTO local_credentials (user_id, password_hash) VALUES ($1, $2)
             ON CONFLICT (user_id) DO UPDATE SET password_hash = EXCLUDED.password_hash",
        )
        .bind(user.id)
        .bind(&hash)
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;
    Ok(user)
}

pub async fn delete_user(pool: &PgPool, id: Uuid) -> AppResult<()> {
    // Schema cascades cover oauth_identities, local_credentials, owned_items,
    // preorders, photos, scans (all reference users.id ON DELETE CASCADE).
    // Figures keep their `created_by` set to NULL on user deletion.
    let result = sqlx::query("DELETE FROM users WHERE id = $1")
        .bind(id)
        .execute(pool)
        .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    Ok(())
}

/// Top-line counters for the admin overview page.
#[derive(Debug, Clone, Serialize)]
pub struct AdminOverview {
    pub user_count: i64,
    pub admin_count: i64,
    pub figure_count: i64,
    pub owned_item_count: i64,
    pub preorder_count: i64,
    pub photo_count: i64,
    pub scan_count: i64,
}

pub async fn overview(pool: &PgPool) -> AppResult<AdminOverview> {
    let row: (i64, i64, i64, i64, i64, i64, i64) = sqlx::query_as(
        "SELECT
            (SELECT COUNT(*)::bigint FROM users),
            (SELECT COUNT(*)::bigint FROM users WHERE is_admin),
            (SELECT COUNT(*)::bigint FROM figures),
            (SELECT COUNT(*)::bigint FROM owned_items),
            (SELECT COUNT(*)::bigint FROM preorders),
            (SELECT COUNT(*)::bigint FROM photos),
            (SELECT COUNT(*)::bigint FROM scans)",
    )
    .fetch_one(pool)
    .await?;
    Ok(AdminOverview {
        user_count: row.0,
        admin_count: row.1,
        figure_count: row.2,
        owned_item_count: row.3,
        preorder_count: row.4,
        photo_count: row.5,
        scan_count: row.6,
    })
}

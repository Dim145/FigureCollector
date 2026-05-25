//! User repository — runtime sqlx queries.

use crate::error::{AppError, AppResult};
use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::{FromRow, PgPool};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct User {
    pub id: Uuid,
    pub username: String,
    pub email: Option<String>,
    pub display_name: String,
    pub avatar_url: Option<String>,
    pub locale: String,
    pub is_admin: bool,
    /// "hide" (default) / "blur" / "show" — per-user NSFW visibility.
    pub nsfw_visibility: String,
    /// ISO 4217 default currency for every form that asks for a price.
    /// `None` ↦ SPA falls back to its built-in default (JPY).
    pub preferred_currency: Option<String>,
    /// Whether the user's collection is browsable at `/u/{username}`.
    pub public_profile_enabled: bool,
    /// Whether NSFW pieces are listed on the user's public profile.
    /// Only meaningful when `public_profile_enabled` is true.
    pub public_profile_show_nsfw: bool,
    pub created_at: DateTime<Utc>,
    pub last_login_at: Option<DateTime<Utc>>,
}

/// Public profile slice — what the frontend gets.
#[derive(Debug, Clone, Serialize)]
pub struct PublicUser {
    pub id: Uuid,
    pub username: String,
    pub display_name: String,
    pub avatar_url: Option<String>,
    pub locale: String,
    /// Exposed so the SPA can show or hide admin entry points. Not used as
    /// an authorisation gate by itself — every admin endpoint re-checks
    /// `is_admin` server-side.
    pub is_admin: bool,
    /// Drives the SPA's filtering / blur behaviour for NSFW figures.
    /// The server already filters most queries, this is the SPA mirror.
    pub nsfw_visibility: String,
    /// Default currency the SPA pre-fills in every price input. `None`
    /// means "use the SPA's built-in default" (currently JPY).
    pub preferred_currency: Option<String>,
    /// Whether the collection is browsable at /u/{username}.
    pub public_profile_enabled: bool,
    /// Whether NSFW pieces are surfaced on /u/{username} when public.
    pub public_profile_show_nsfw: bool,
}

impl From<User> for PublicUser {
    fn from(u: User) -> Self {
        Self {
            id: u.id,
            username: u.username,
            display_name: u.display_name,
            avatar_url: u.avatar_url,
            locale: u.locale,
            is_admin: u.is_admin,
            nsfw_visibility: u.nsfw_visibility,
            preferred_currency: u.preferred_currency,
            public_profile_enabled: u.public_profile_enabled,
            public_profile_show_nsfw: u.public_profile_show_nsfw,
        }
    }
}

const USER_COLUMNS: &str =
    "id, username, email, display_name, avatar_url, locale, is_admin, \
     nsfw_visibility, preferred_currency, \
     public_profile_enabled, public_profile_show_nsfw, \
     created_at, last_login_at";

pub async fn create_local(
    pool: &PgPool,
    username: &str,
    email: Option<&str>,
    display_name: &str,
    password_hash: &str,
) -> AppResult<User> {
    let mut tx = pool.begin().await?;
    let user_id = Uuid::now_v7();

    // Bootstrap: the very first user on a fresh DB gets admin. Computed
    // *inside* the transaction so two simultaneous signups can't both win.
    let is_admin = should_bootstrap_admin(&mut tx).await?;

    let insert_sql = format!(
        "INSERT INTO users (id, username, email, display_name, locale, is_admin) \
         VALUES ($1, $2, $3, $4, 'fr', $5) \
         RETURNING {USER_COLUMNS}"
    );
    let row: User = match sqlx::query_as(&insert_sql)
        .bind(user_id)
        .bind(username)
        .bind(email)
        .bind(display_name)
        .bind(is_admin)
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
        .bind(password_hash)
        .execute(&mut *tx)
        .await?;

    tx.commit().await?;
    if row.is_admin {
        tracing::info!(user_id = %row.id, username, "first user promoted to admin");
    }
    Ok(row)
}

/// Promote the first ever user to admin. Called inside a transaction so two
/// simultaneous signups can't both flip to true (the `SELECT COUNT(*)` runs
/// in the same row-locking context as the subsequent INSERT).
async fn should_bootstrap_admin(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
) -> AppResult<bool> {
    let (count,): (i64,) = sqlx::query_as("SELECT COUNT(*)::bigint FROM users")
        .fetch_one(&mut **tx)
        .await?;
    Ok(count == 0)
}

pub async fn find_by_username(pool: &PgPool, username: &str) -> AppResult<Option<User>> {
    let sql = format!("SELECT {USER_COLUMNS} FROM users WHERE username = $1");
    let row = sqlx::query_as::<_, User>(&sql)
        .bind(username)
        .fetch_optional(pool)
        .await?;
    Ok(row)
}

pub async fn find_by_id(pool: &PgPool, id: Uuid) -> AppResult<Option<User>> {
    let sql = format!("SELECT {USER_COLUMNS} FROM users WHERE id = $1");
    let row = sqlx::query_as::<_, User>(&sql)
        .bind(id)
        .fetch_optional(pool)
        .await?;
    Ok(row)
}

pub async fn get_local_password_hash(pool: &PgPool, user_id: Uuid) -> AppResult<Option<String>> {
    let row: Option<(String,)> =
        sqlx::query_as("SELECT password_hash FROM local_credentials WHERE user_id = $1")
            .bind(user_id)
            .fetch_optional(pool)
            .await?;
    Ok(row.map(|r| r.0))
}

pub async fn touch_last_login(pool: &PgPool, user_id: Uuid) -> AppResult<()> {
    sqlx::query("UPDATE users SET last_login_at = now() WHERE id = $1")
        .bind(user_id)
        .execute(pool)
        .await?;
    Ok(())
}

/// Look up an OIDC identity; if it doesn't exist, create the user + identity row.
/// If it exists, optionally refresh email/avatar from the latest claims.
pub async fn upsert_oauth_user(
    pool: &PgPool,
    provider: &str,
    subject: &str,
    email: Option<&str>,
    display_name_hint: Option<&str>,
    preferred_username_hint: Option<&str>,
    avatar_url: Option<&str>,
) -> AppResult<User> {
    let mut tx = pool.begin().await?;

    // 1) Try to find an existing identity.
    let existing: Option<(Uuid,)> = sqlx::query_as(
        "SELECT user_id FROM oauth_identities WHERE provider = $1 AND subject = $2",
    )
    .bind(provider)
    .bind(subject)
    .fetch_optional(&mut *tx)
    .await?;

    if let Some((user_id,)) = existing {
        // Refresh email/avatar opportunistically.
        if email.is_some() || avatar_url.is_some() {
            sqlx::query(
                "UPDATE users SET
                   email      = COALESCE($1, email),
                   avatar_url = COALESCE($2, avatar_url)
                 WHERE id = $3",
            )
            .bind(email)
            .bind(avatar_url)
            .bind(user_id)
            .execute(&mut *tx)
            .await?;
        }

        let sql = format!("SELECT {USER_COLUMNS} FROM users WHERE id = $1");
        let user: User = sqlx::query_as(&sql)
            .bind(user_id)
            .fetch_one(&mut *tx)
            .await?;

        tx.commit().await?;
        return Ok(user);
    }

    // 2) Mint a new user. We need a unique username — try the preferred one first,
    //    then fall back to email-local, then to a `user-<random>` slug.
    let candidate = preferred_username_hint
        .map(slugify_username)
        .filter(|s| !s.is_empty())
        .or_else(|| email.and_then(|e| e.split('@').next().map(slugify_username)))
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| format!("user-{:08x}", rand::random::<u32>()));

    let display_name = display_name_hint
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(&candidate)
        .to_string();

    let user_id = Uuid::now_v7();
    let mut attempted = candidate.clone();

    // Same bootstrap as create_local: the first user on a clean DB is admin.
    let is_admin = should_bootstrap_admin(&mut tx).await?;

    // Cap retry attempts to avoid runaway loops in pathological cases
    // (e.g. a deterministic RNG, or every variant somehow taken). At 16-bit
    // randomness 32 tries is well below any realistic collision rate.
    const MAX_USERNAME_ATTEMPTS: u32 = 32;
    let mut attempts = 0u32;

    let user: User = loop {
        attempts += 1;
        if attempts > MAX_USERNAME_ATTEMPTS {
            return Err(AppError::Internal(anyhow::anyhow!(
                "could not allocate a free username after {MAX_USERNAME_ATTEMPTS} attempts"
            )));
        }

        // Each attempt is wrapped in a SAVEPOINT. Without this, the first
        // unique_violation poisons the whole outer transaction and every
        // subsequent INSERT returns "current transaction is aborted, commands
        // ignored until end of transaction block" — NOT a unique_violation —
        // so the match arm below never fires and we'd bail out on the first
        // collision instead of retrying. The savepoint isolates each attempt
        // so a unique_violation rolls back only the failed INSERT.
        sqlx::query("SAVEPOINT username_attempt")
            .execute(&mut *tx)
            .await?;

        let insert_sql = format!(
            "INSERT INTO users (id, username, email, display_name, avatar_url, locale, is_admin) \
             VALUES ($1, $2, $3, $4, $5, 'fr', $6) \
             RETURNING {USER_COLUMNS}"
        );
        let result = sqlx::query_as::<_, User>(&insert_sql)
            .bind(user_id)
            .bind(&attempted)
            .bind(email)
            .bind(&display_name)
            .bind(avatar_url)
            .bind(is_admin)
            .fetch_one(&mut *tx)
            .await;

        match result {
            Ok(u) => {
                sqlx::query("RELEASE SAVEPOINT username_attempt")
                    .execute(&mut *tx)
                    .await?;
                break u;
            }
            Err(sqlx::Error::Database(db)) if db.is_unique_violation() => {
                sqlx::query("ROLLBACK TO SAVEPOINT username_attempt")
                    .execute(&mut *tx)
                    .await?;
                attempted = format!("{candidate}-{:04x}", rand::random::<u16>());
                continue;
            }
            Err(e) => return Err(e.into()),
        }
    };

    sqlx::query(
        "INSERT INTO oauth_identities (provider, subject, user_id, email) VALUES ($1, $2, $3, $4)",
    )
    .bind(provider)
    .bind(subject)
    .bind(user.id)
    .bind(email)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok(user)
}

fn slugify_username(s: impl AsRef<str>) -> String {
    s.as_ref()
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '_' || c == '-' || c == '.' {
                c.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .chars()
        .take(32)
        .collect()
}

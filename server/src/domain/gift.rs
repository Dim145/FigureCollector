//! Public gift-list sharing (`gift_share_token` on `users` + `gift_reservations`).
//!
//! An owner mints a share token; anyone with the resulting `/g/<token>` link
//! can claim ("reserve") a wished figure so two gift-givers don't buy the same
//! thing. The reserver gets back a secret `reserver_token` (kept in their
//! browser) that lets only them release the claim later.
//!
//! Reservations are deliberately **hidden from the owner** — that rule is
//! enforced in the route layer (`routes::gift`), which knows who the viewer is.

use crate::error::{AppError, AppResult};
use serde::Serialize;
use sqlx::{FromRow, PgPool};
use uuid::Uuid;

/// One reservation as a gift-giver sees it (never surfaced to the owner).
#[derive(Debug, Clone, Serialize, FromRow)]
pub struct Reservation {
    pub figure_id: Uuid,
    pub reserver_name: String,
}

/// Mint a URL-safe, unguessable share/reserver token: 128 bits of entropy as
/// 32 hex chars. Uses `rand::random` (already a dependency) — no UUID v4
/// feature needed, and full randomness (unlike v7) leaks nothing.
fn mint_token() -> String {
    format!(
        "{:016x}{:016x}",
        rand::random::<u64>(),
        rand::random::<u64>()
    )
}

/// The user's current share token, or `None` when sharing is off.
pub async fn share_token(pool: &PgPool, user_id: Uuid) -> AppResult<Option<String>> {
    let row: Option<(Option<String>,)> =
        sqlx::query_as("SELECT gift_share_token FROM users WHERE id = $1")
            .bind(user_id)
            .fetch_optional(pool)
            .await?;
    Ok(row.and_then(|r| r.0))
}

/// Enable sharing: keep the existing token if present, else mint one. Returns
/// the live token. Idempotent — calling twice yields the same link.
pub async fn enable_share(pool: &PgPool, user_id: Uuid) -> AppResult<String> {
    if let Some(tok) = share_token(pool, user_id).await? {
        return Ok(tok);
    }
    // Retry on the (vanishingly rare) token collision.
    for _ in 0..5 {
        let tok = mint_token();
        let res = sqlx::query(
            "UPDATE users SET gift_share_token = $1
             WHERE id = $2 AND gift_share_token IS NULL",
        )
        .bind(&tok)
        .bind(user_id)
        .execute(pool)
        .await;
        match res {
            Ok(r) if r.rows_affected() == 1 => return Ok(tok),
            // Either the user vanished, or a token was set concurrently — re-read.
            Ok(_) => {
                return share_token(pool, user_id)
                    .await?
                    .ok_or(AppError::NotFound);
            }
            Err(sqlx::Error::Database(db)) if db.is_unique_violation() => continue,
            Err(e) => return Err(e.into()),
        }
    }
    Err(AppError::Internal(anyhow::anyhow!(
        "could not allocate a unique gift-share token"
    )))
}

/// Disable sharing: kill the link and wipe every reservation (a clean reset, so
/// re-enabling later starts fresh under a new token).
pub async fn disable_share(pool: &PgPool, user_id: Uuid) -> AppResult<()> {
    let mut tx = pool.begin().await?;
    sqlx::query("DELETE FROM gift_reservations WHERE owner_user_id = $1")
        .bind(user_id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("UPDATE users SET gift_share_token = NULL WHERE id = $1")
        .bind(user_id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(())
}

/// Every reservation for an owner's gift list (figure → reserver name).
pub async fn reservations_for_owner(pool: &PgPool, owner_id: Uuid) -> AppResult<Vec<Reservation>> {
    Ok(sqlx::query_as::<_, Reservation>(
        "SELECT figure_id, reserver_name FROM gift_reservations WHERE owner_user_id = $1",
    )
    .bind(owner_id)
    .fetch_all(pool)
    .await?)
}

/// Claim a wished figure. The figure must actually be on the owner's wishlist
/// (so a forged `figure_id` can't seed arbitrary rows). Returns the secret
/// `reserver_token`. `Conflict` if the piece is already claimed.
pub async fn reserve(
    pool: &PgPool,
    owner_id: Uuid,
    figure_id: Uuid,
    reserver_name: &str,
) -> AppResult<String> {
    let on_wishlist: Option<(Uuid,)> =
        sqlx::query_as("SELECT figure_id FROM wishlist_items WHERE user_id = $1 AND figure_id = $2")
            .bind(owner_id)
            .bind(figure_id)
            .fetch_optional(pool)
            .await?;
    if on_wishlist.is_none() {
        return Err(AppError::NotFound);
    }

    let token = mint_token();
    let res = sqlx::query(
        "INSERT INTO gift_reservations (owner_user_id, figure_id, reserver_name, reserver_token)
         VALUES ($1, $2, $3, $4)",
    )
    .bind(owner_id)
    .bind(figure_id)
    .bind(reserver_name)
    .bind(&token)
    .execute(pool)
    .await;

    match res {
        Ok(_) => Ok(token),
        Err(sqlx::Error::Database(db)) if db.is_unique_violation() => {
            Err(AppError::Conflict("this piece is already reserved"))
        }
        Err(e) => Err(e.into()),
    }
}

/// Release a claim — only the giver who holds the matching `reserver_token`
/// can. `NotFound` when nothing matches (wrong token / already released).
pub async fn release(
    pool: &PgPool,
    owner_id: Uuid,
    figure_id: Uuid,
    reserver_token: &str,
) -> AppResult<()> {
    let res = sqlx::query(
        "DELETE FROM gift_reservations
         WHERE owner_user_id = $1 AND figure_id = $2 AND reserver_token = $3",
    )
    .bind(owner_id)
    .bind(figure_id)
    .bind(reserver_token)
    .execute(pool)
    .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    Ok(())
}

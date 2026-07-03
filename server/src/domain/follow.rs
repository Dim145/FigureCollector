//! Same-instance social graph: follow / unfollow plus the read surfaces built
//! on top of it (discovery, follower / following lists, relationship + count
//! probes for the public profile).
//!
//! The graph is a single directed `follows` table (follower → followee).
//! Everything here is either a tiny write or a read over it joined to `users`
//! / `owned_items`. There is no cross-instance federation — "collectors" are
//! other accounts on this same server that opted their profile public.

use crate::error::AppResult;
use rust_decimal::Decimal;
use serde::Serialize;
use sqlx::{FromRow, PgPool};
use uuid::Uuid;

/// Which side of an edge a list walks.
#[derive(Clone, Copy)]
pub enum Direction {
    /// Accounts that follow the target (target's followers).
    Followers,
    /// Accounts the target follows (target's following).
    Following,
}

/// One collector as shown on a discovery card or in a follow list. `value`
/// and `preview` are populated for discovery and left empty for list rows
/// (which don't need them) — keeping a single shape the SPA can render
/// uniformly.
#[derive(Serialize)]
pub struct CollectorCard {
    pub id: Uuid,
    pub username: String,
    pub display_name: String,
    pub avatar_url: Option<String>,
    pub pieces: i64,
    pub followers: i64,
    /// viewer → them: drives the follow button state.
    pub is_following: bool,
    /// them → viewer: drives the "vous suit" / mutual hint.
    pub follows_viewer: bool,
    /// Whether the viewer can open their vitrine (`public_profile_enabled`).
    pub is_public: bool,
    /// Per-currency effective value (no FX). Empty unless they opted in.
    pub value: Vec<CurrencyTotal>,
    /// Up to 4 most-recent pieces for the shelf peek. Empty for list rows.
    pub preview: Vec<PreviewItem>,
}

#[derive(Serialize, Clone, FromRow)]
pub struct CurrencyTotal {
    pub currency: String,
    pub amount: Decimal,
}

#[derive(Serialize, Clone)]
pub struct PreviewItem {
    pub figure_id: Uuid,
    pub figure_type: String,
    pub figure_image: Option<String>,
    /// Lets the SPA blur per the *viewer's* nsfw_visibility even when the
    /// collector chose to show NSFW on their public profile.
    pub is_nsfw: bool,
}

// --- writes ------------------------------------------------------------------

/// Follow `target` as `me`. Idempotent (re-following is a no-op); a self-follow
/// is a clean no-op here and also barred by the `follows_no_self` CHECK.
pub async fn follow(pool: &PgPool, me: Uuid, target: Uuid) -> AppResult<()> {
    if me == target {
        return Ok(());
    }
    sqlx::query(
        "INSERT INTO follows (follower_id, followee_id) VALUES ($1, $2)
         ON CONFLICT (follower_id, followee_id) DO NOTHING",
    )
    .bind(me)
    .bind(target)
    .execute(pool)
    .await?;
    Ok(())
}

/// Unfollow `target` as `me`. No-op if the edge doesn't exist.
pub async fn unfollow(pool: &PgPool, me: Uuid, target: Uuid) -> AppResult<()> {
    sqlx::query("DELETE FROM follows WHERE follower_id = $1 AND followee_id = $2")
        .bind(me)
        .bind(target)
        .execute(pool)
        .await?;
    Ok(())
}

// --- probes (for the public profile) -----------------------------------------

#[derive(FromRow)]
struct CountsRow {
    followers: i64,
    following: i64,
}

/// `(followers, following)` counts for `user_id` — the two numbers on a
/// profile, in one round-trip.
pub async fn counts(pool: &PgPool, user_id: Uuid) -> AppResult<(i64, i64)> {
    // Count only publicly-visible relations, to match the list (`list_relations`
    // filters the counterparty on `public_profile_enabled`) — so the badge
    // equals what the list shows. Followers: the *follower* must be public;
    // following: the *followee* must be public.
    let row: CountsRow = sqlx::query_as(
        "SELECT
            (SELECT COUNT(*) FROM follows f JOIN users u ON u.id = f.follower_id
               WHERE f.followee_id = $1 AND u.public_profile_enabled = TRUE)::bigint AS followers,
            (SELECT COUNT(*) FROM follows f JOIN users u ON u.id = f.followee_id
               WHERE f.follower_id = $1 AND u.public_profile_enabled = TRUE)::bigint AS following",
    )
    .bind(user_id)
    .fetch_one(pool)
    .await?;
    Ok((row.followers, row.following))
}

#[derive(FromRow)]
struct RelRow {
    is_following: bool,
    follows_viewer: bool,
}

/// `(is_following, follows_viewer)` for `viewer` relative to `target`. Used to
/// drive the follow button and the mutual hint on the profile.
pub async fn relationship(pool: &PgPool, viewer: Uuid, target: Uuid) -> AppResult<(bool, bool)> {
    let row: RelRow = sqlx::query_as(
        "SELECT
            EXISTS(SELECT 1 FROM follows WHERE follower_id = $1 AND followee_id = $2) AS is_following,
            EXISTS(SELECT 1 FROM follows WHERE follower_id = $2 AND followee_id = $1) AS follows_viewer",
    )
    .bind(viewer)
    .bind(target)
    .fetch_one(pool)
    .await?;
    Ok((row.is_following, row.follows_viewer))
}

// --- discovery ---------------------------------------------------------------

/// Public collectors on this instance, with shelf-peek + opt-in value, ranked
/// by collection size. `search` filters on display name / username (empty =
/// all). The viewer is excluded from their own discovery list.
pub async fn discover(pool: &PgPool, viewer: Uuid, search: &str) -> AppResult<Vec<CollectorCard>> {
    #[derive(FromRow)]
    struct Base {
        id: Uuid,
        username: String,
        display_name: String,
        avatar_url: Option<String>,
        pieces: i64,
        followers: i64,
        is_following: bool,
        follows_viewer: bool,
        show_value: bool,
    }

    // 1) Base cards + scalar relationship stats. NSFW pieces are counted only
    //    when the collector opened their profile to NSFW (mirrors the public
    //    profile's own piece count).
    let base: Vec<Base> = sqlx::query_as(
        "SELECT u.id, u.username, u.display_name, u.avatar_url,
                (SELECT COUNT(*) FROM owned_items o JOIN figures f ON f.id = o.figure_id
                   WHERE o.user_id = u.id
                     AND (u.public_profile_show_nsfw OR f.is_nsfw = FALSE))::bigint AS pieces,
                -- Count only publicly-visible followers, to match the list.
                (SELECT COUNT(*) FROM follows fo JOIN users fu ON fu.id = fo.follower_id
                   WHERE fo.followee_id = u.id AND fu.public_profile_enabled = TRUE)::bigint AS followers,
                EXISTS(SELECT 1 FROM follows fo WHERE fo.follower_id = $1 AND fo.followee_id = u.id) AS is_following,
                EXISTS(SELECT 1 FROM follows fo WHERE fo.follower_id = u.id AND fo.followee_id = $1) AS follows_viewer,
                u.public_profile_show_value AS show_value
         FROM users u
         WHERE u.public_profile_enabled = TRUE
           AND u.id <> $1
           AND ($2 = '' OR u.display_name ILIKE '%' || $2 || '%' OR u.username ILIKE '%' || $2 || '%')
         ORDER BY pieces DESC, u.display_name ASC
         LIMIT 60",
    )
    .bind(viewer)
    .bind(search)
    .fetch_all(pool)
    .await?;

    if base.is_empty() {
        return Ok(Vec::new());
    }
    let ids: Vec<Uuid> = base.iter().map(|b| b.id).collect();

    // 2) Opt-in value, per currency, using the SAME effective value as "La
    //    Cote" (manual `value_amount` when set, else catalog MSRP) — so a
    //    collector's discovery figure matches what they see on /cote.
    #[derive(FromRow)]
    struct ValRow {
        user_id: Uuid,
        currency: String,
        amount: Decimal,
    }
    let vals: Vec<ValRow> = sqlx::query_as(
        "SELECT user_id, currency, SUM(amount)::numeric AS amount FROM (
            SELECT o.user_id,
                   CASE WHEN o.value_amount IS NOT NULL
                        THEN COALESCE(o.value_currency, o.price_currency, f.msrp_currency)
                        ELSE f.msrp_currency END            AS currency,
                   COALESCE(o.value_amount, f.msrp_amount)  AS amount
            FROM owned_items o
            JOIN figures f ON f.id = o.figure_id
            JOIN users u   ON u.id = o.user_id
            WHERE o.user_id = ANY($1)
              AND u.public_profile_show_value = TRUE
              AND (u.public_profile_show_nsfw OR f.is_nsfw = FALSE)
         ) s
         WHERE amount IS NOT NULL AND currency IS NOT NULL
         GROUP BY user_id, currency
         ORDER BY amount DESC",
    )
    .bind(&ids)
    .fetch_all(pool)
    .await?;

    // 3) Shelf peek: the 4 most-recent pieces per collector, NSFW-gated by
    //    their own public preference (the viewer still blurs client-side).
    #[derive(FromRow)]
    struct PrevRow {
        user_id: Uuid,
        figure_id: Uuid,
        figure_type: String,
        figure_image: Option<String>,
        is_nsfw: bool,
    }
    let prevs: Vec<PrevRow> = sqlx::query_as(
        "SELECT user_id, figure_id, figure_type, figure_image, is_nsfw FROM (
            SELECT o.user_id, f.id AS figure_id, f.figure_type,
                   f.official_image_url AS figure_image, f.is_nsfw,
                   ROW_NUMBER() OVER (PARTITION BY o.user_id ORDER BY o.created_at DESC) AS rn
            FROM owned_items o
            JOIN figures f ON f.id = o.figure_id
            JOIN users u   ON u.id = o.user_id
            WHERE o.user_id = ANY($1)
              AND (u.public_profile_show_nsfw OR f.is_nsfw = FALSE)
         ) s
         WHERE rn <= 4",
    )
    .bind(&ids)
    .fetch_all(pool)
    .await?;

    let cards = base
        .into_iter()
        .map(|b| {
            let value = if b.show_value {
                vals.iter()
                    .filter(|v| v.user_id == b.id)
                    .map(|v| CurrencyTotal {
                        currency: v.currency.clone(),
                        amount: v.amount,
                    })
                    .collect()
            } else {
                Vec::new()
            };
            let preview = prevs
                .iter()
                .filter(|p| p.user_id == b.id)
                .map(|p| PreviewItem {
                    figure_id: p.figure_id,
                    figure_type: p.figure_type.clone(),
                    figure_image: p.figure_image.clone(),
                    is_nsfw: p.is_nsfw,
                })
                .collect();
            CollectorCard {
                id: b.id,
                username: b.username,
                display_name: b.display_name,
                avatar_url: b.avatar_url,
                pieces: b.pieces,
                followers: b.followers,
                is_following: b.is_following,
                follows_viewer: b.follows_viewer,
                is_public: true,
                value,
                preview,
            }
        })
        .collect();
    Ok(cards)
}

// --- follower / following lists ----------------------------------------------

/// Walk one side of `target`'s edges. `viewer` (when present) gets per-row
/// `is_following` / `follows_viewer` so the list can show the follow button
/// and mutual chips; an anonymous viewer sees those as `false`.
pub async fn list_relations(
    pool: &PgPool,
    viewer: Option<Uuid>,
    target: Uuid,
    dir: Direction,
) -> AppResult<Vec<CollectorCard>> {
    // For followers we surface the *follower* side of each edge; for
    // following, the *followee* side. Both column names are compile-time
    // literals (never user input), so interpolating them is safe.
    let (join_col, where_col) = match dir {
        Direction::Followers => ("follower_id", "followee_id"),
        Direction::Following => ("followee_id", "follower_id"),
    };
    // Nil viewer never matches any edge → relationship flags stay false.
    let viewer_id = viewer.unwrap_or(Uuid::nil());

    #[derive(FromRow)]
    struct Row {
        id: Uuid,
        username: String,
        display_name: String,
        avatar_url: Option<String>,
        pieces: i64,
        followers: i64,
        is_following: bool,
        follows_viewer: bool,
        is_public: bool,
    }

    let sql = format!(
        "SELECT u.id, u.username, u.display_name, u.avatar_url,
                (SELECT COUNT(*) FROM owned_items o JOIN figures f ON f.id = o.figure_id
                   WHERE o.user_id = u.id
                     AND (u.public_profile_show_nsfw OR f.is_nsfw = FALSE))::bigint AS pieces,
                -- Count only publicly-visible followers, to match the list.
                (SELECT COUNT(*) FROM follows fx JOIN users fu ON fu.id = fx.follower_id
                   WHERE fx.followee_id = u.id AND fu.public_profile_enabled = TRUE)::bigint AS followers,
                EXISTS(SELECT 1 FROM follows fx WHERE fx.follower_id = $2 AND fx.followee_id = u.id) AS is_following,
                EXISTS(SELECT 1 FROM follows fx WHERE fx.follower_id = u.id AND fx.followee_id = $2) AS follows_viewer,
                u.public_profile_enabled AS is_public
         FROM follows fo
         JOIN users u ON u.id = fo.{join_col}
         WHERE fo.{where_col} = $1
           AND u.public_profile_enabled = TRUE
         ORDER BY fo.created_at DESC"
    );

    let rows: Vec<Row> = sqlx::query_as(&sql)
        .bind(target)
        .bind(viewer_id)
        .fetch_all(pool)
        .await?;

    Ok(rows
        .into_iter()
        .map(|r| CollectorCard {
            id: r.id,
            username: r.username,
            display_name: r.display_name,
            avatar_url: r.avatar_url,
            pieces: r.pieces,
            followers: r.followers,
            is_following: r.is_following,
            follows_viewer: r.follows_viewer,
            is_public: r.is_public,
            value: Vec::new(),
            preview: Vec::new(),
        })
        .collect())
}

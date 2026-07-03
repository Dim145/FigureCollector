//! Achievements rules engine — Phase 4B.
//!
//! Reads from sea-orm entities (`entity::achievements`, `entity::user_achievements`)
//! and counters via raw sqlx (the counts query owned_items / preorders /
//! scans tables that haven't been migrated to sea-orm yet — that's the
//! whole point of carrying both handles in AppState during the transition).
//!
//! Called from mutation handlers after the underlying record has been
//! written. Returns the list of *newly* unlocked achievements so the
//! caller can push a WS toast.

use crate::entity::{achievements, user_achievements};
use crate::error::AppResult;
use chrono::Utc;
use sea_orm::{
    ActiveModelTrait, ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter, Set,
};
use sqlx::PgPool;
use std::collections::HashSet;
use uuid::Uuid;

/// Per-user counters we evaluate achievement thresholds against.
#[derive(Debug, Default)]
struct Counters {
    pieces_owned: i64,
    preorders_placed: i64,
    preorders_received: i64,
    scans_created: i64,
}

async fn counters_for(pool: &PgPool, user_id: Uuid) -> AppResult<Counters> {
    let (pieces_owned,): (i64,) =
        sqlx::query_as("SELECT COUNT(*)::bigint FROM owned_items WHERE user_id = $1")
            .bind(user_id)
            .fetch_one(pool)
            .await?;
    let (preorders_placed,): (i64,) =
        sqlx::query_as("SELECT COUNT(*)::bigint FROM preorders WHERE user_id = $1")
            .bind(user_id)
            .fetch_one(pool)
            .await?;
    let (preorders_received,): (i64,) = sqlx::query_as(
        "SELECT COUNT(*)::bigint FROM preorders WHERE user_id = $1 AND status = 'received'",
    )
    .bind(user_id)
    .fetch_one(pool)
    .await?;
    let (scans_created,): (i64,) = sqlx::query_as(
        "SELECT COUNT(*)::bigint FROM scans
         WHERE owned_item_id IN (SELECT id FROM owned_items WHERE user_id = $1)",
    )
    .bind(user_id)
    .fetch_one(pool)
    .await?;
    Ok(Counters {
        pieces_owned,
        preorders_placed,
        preorders_received,
        scans_created,
    })
}

/// Run the rules engine for `user_id`. Grants any newly-met achievements
/// (writes via sea-orm) and returns them so the caller can fan them out
/// over the WebSocket.
///
/// `trigger_figure_id` is the figurine the calling mutation revolved around
/// (e.g. the figure that was just added to the collection, or the preorder's
/// figure). It's stored on the user_achievements row so the /achievements
/// page can show the actual figurine photo on the seal — a far more
/// meaningful trophy than a generic kanji glyph. Pass `None` for triggers
/// that aren't tied to a single figure.
pub async fn check_and_grant(
    db: &DatabaseConnection,
    pool: &PgPool,
    user_id: Uuid,
    trigger_figure_id: Option<Uuid>,
) -> AppResult<Vec<achievements::Model>> {
    let counters = counters_for(pool, user_id).await?;

    // What's already unlocked for this user?
    let already: HashSet<String> = user_achievements::Entity::find()
        .filter(user_achievements::Column::UserId.eq(user_id))
        .all(db)
        .await?
        .into_iter()
        .map(|m| m.achievement_code)
        .collect();

    // Walk the whole catalog; the table is small (<100 rows).
    let catalog = achievements::Entity::find().all(db).await?;

    let mut newly = Vec::new();
    for a in catalog {
        if already.contains(&a.code) {
            continue;
        }
        let value = match a.kind.as_str() {
            "pieces_owned" => counters.pieces_owned,
            "preorders_placed" => counters.preorders_placed,
            "preorders_received" => counters.preorders_received,
            "scans_created" => counters.scans_created,
            _ => continue,
        };
        if value < a.threshold as i64 {
            continue;
        }

        // Atomic insert; ignore duplicate races just in case.
        let insert = user_achievements::ActiveModel {
            user_id: Set(user_id),
            achievement_code: Set(a.code.clone()),
            unlocked_at: Set(Utc::now()),
            trigger_figure_id: Set(trigger_figure_id),
        }
        .insert(db)
        .await;

        match insert {
            Ok(_) => {
                tracing::info!(user_id = %user_id, code = %a.code, "achievement unlocked");
                newly.push(a);
            }
            Err(e) => {
                // Probably a unique-violation race — count as already granted.
                tracing::debug!(error = ?e, code = %a.code, "achievement grant skipped");
            }
        }
    }

    Ok(newly)
}

/// Public catalog (no auth required).
pub async fn list_catalog(db: &DatabaseConnection) -> AppResult<Vec<achievements::Model>> {
    use sea_orm::QueryOrder;
    Ok(achievements::Entity::find()
        .order_by_asc(achievements::Column::SortOrder)
        .all(db)
        .await?)
}

/// `(achievement, unlocked_at, trigger_figure)` for everything `user_id`
/// has unlocked, newest first. Goes through raw sqlx instead of sea-orm so
/// we can resolve the trigger figurine + its preferred cover image in a
/// single query.
///
/// The cover-resolution priority is the same as elsewhere in the app:
///   1. The user's own cover photo (`owned_items.cover_photo_id`)
///   2. The catalog's primary figure photo
///   3. The figure's `official_image_url` (legacy/external)
/// The frontend treats every URL as opaque — the backend already knows
/// which photos endpoint to hit.
pub async fn list_for_user(
    pool: &PgPool,
    user_id: Uuid,
) -> AppResult<Vec<UnlockedAchievement>> {
    Ok(sqlx::query_as::<_, UnlockedAchievement>(
        "SELECT
            ua.achievement_code             AS code,
            ua.unlocked_at                  AS unlocked_at,
            a.category                      AS category,
            a.tier                          AS tier,
            a.kind                          AS kind,
            a.threshold                     AS threshold,
            ua.trigger_figure_id            AS trigger_figure_id,
            f.name                          AS trigger_figure_name,
            f.slug                          AS trigger_figure_slug,
            f.figure_type                   AS trigger_figure_type,
            f.is_nsfw                       AS trigger_is_nsfw,
            -- Cover URL: prefer the user's own cover photo, then the
            -- catalog's primary figure photo, then the legacy
            -- official_image_url field. NULL when nothing's available.
            COALESCE(
                CASE WHEN owned_cover.cover_photo_id IS NOT NULL
                     THEN '/api/photos/' || owned_cover.cover_photo_id::text
                END,
                CASE WHEN catalog_photo.id IS NOT NULL
                     THEN '/api/figure-photos/' || catalog_photo.id::text
                END,
                f.official_image_url
            ) AS trigger_image_url
         FROM user_achievements ua
         JOIN achievements a ON a.code = ua.achievement_code
         LEFT JOIN figures   f ON f.id = ua.trigger_figure_id
         -- The viewer's own cover preference for that figure, if they own it.
         LEFT JOIN LATERAL (
             SELECT cover_photo_id
             FROM owned_items o
             WHERE o.user_id = ua.user_id
               AND o.figure_id = ua.trigger_figure_id
               AND o.cover_photo_id IS NOT NULL
             LIMIT 1
         ) owned_cover ON TRUE
         -- The catalog's primary photo for that figure, if any.
         LEFT JOIN LATERAL (
             SELECT fp.id
             FROM figure_photos fp
             WHERE fp.figure_id = ua.trigger_figure_id
             ORDER BY fp.is_primary DESC, fp.position ASC, fp.created_at ASC
             LIMIT 1
         ) catalog_photo ON TRUE
         WHERE ua.user_id = $1
         ORDER BY ua.unlocked_at DESC",
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?)
}

#[derive(Debug, Clone, serde::Serialize, sqlx::FromRow)]
pub struct UnlockedAchievement {
    pub code: String,
    pub unlocked_at: chrono::DateTime<chrono::Utc>,
    pub category: String,
    pub tier: String,
    pub kind: String,
    pub threshold: i32,
    /// The figurine that pushed the user over the threshold, when known.
    pub trigger_figure_id: Option<Uuid>,
    pub trigger_figure_name: Option<String>,
    pub trigger_figure_slug: Option<String>,
    pub trigger_figure_type: Option<String>,
    /// Whether the trigger figurine is flagged NSFW — the achievements page
    /// respects the viewer's `nsfw_visibility` for the seal's cover (generic
    /// placeholder when "hide", blurred when "blur"). NULL when no trigger.
    pub trigger_is_nsfw: Option<bool>,
    pub trigger_image_url: Option<String>,
}

/// Progress toward the nearest *locked* achievements (Lot 5). For each locked,
/// counter-based achievement, how far the user is from its threshold — ranked
/// closest-to-completion first. Drives the "prochain palier" card.
#[derive(Debug, Clone, serde::Serialize)]
pub struct NextMilestone {
    pub code: String,
    pub category: String,
    pub tier: String,
    pub kind: String,
    pub threshold: i32,
    pub current: i64,
    pub remaining: i64,
    pub pct: i32,
}

pub async fn next_milestones(
    db: &DatabaseConnection,
    pool: &PgPool,
    user_id: Uuid,
) -> AppResult<Vec<NextMilestone>> {
    let counters = counters_for(pool, user_id).await?;
    let already: HashSet<String> = user_achievements::Entity::find()
        .filter(user_achievements::Column::UserId.eq(user_id))
        .all(db)
        .await?
        .into_iter()
        .map(|m| m.achievement_code)
        .collect();
    let catalog = achievements::Entity::find().all(db).await?;

    let mut out: Vec<NextMilestone> = catalog
        .into_iter()
        .filter(|a| !already.contains(&a.code))
        .filter_map(|a| {
            let current = match a.kind.as_str() {
                "pieces_owned" => counters.pieces_owned,
                "preorders_placed" => counters.preorders_placed,
                "preorders_received" => counters.preorders_received,
                "scans_created" => counters.scans_created,
                _ => return None,
            };
            let threshold = a.threshold as i64;
            if threshold <= 0 || current >= threshold {
                return None;
            }
            let pct = ((current as f64 / threshold as f64) * 100.0).round() as i32;
            Some(NextMilestone {
                code: a.code,
                category: a.category,
                tier: a.tier,
                kind: a.kind,
                threshold: a.threshold,
                current,
                remaining: threshold - current,
                pct,
            })
        })
        .collect();
    // Closest to completion first; tie-break on fewest remaining.
    out.sort_by(|a, b| b.pct.cmp(&a.pct).then(a.remaining.cmp(&b.remaining)));
    out.truncate(4);
    Ok(out)
}

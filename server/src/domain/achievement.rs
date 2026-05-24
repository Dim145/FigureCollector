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
pub async fn check_and_grant(
    db: &DatabaseConnection,
    pool: &PgPool,
    user_id: Uuid,
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

/// `(achievement, unlocked_at)` for everything `user_id` has unlocked, newest first.
pub async fn list_for_user(
    db: &DatabaseConnection,
    user_id: Uuid,
) -> AppResult<Vec<UnlockedAchievement>> {
    use sea_orm::QueryOrder;
    let rows = user_achievements::Entity::find()
        .filter(user_achievements::Column::UserId.eq(user_id))
        .order_by_desc(user_achievements::Column::UnlockedAt)
        .find_also_related(achievements::Entity)
        .all(db)
        .await?;
    Ok(rows
        .into_iter()
        .filter_map(|(ua, a)| {
            a.map(|a| UnlockedAchievement {
                code: ua.achievement_code,
                unlocked_at: ua.unlocked_at,
                category: a.category,
                tier: a.tier,
                kind: a.kind,
                threshold: a.threshold,
            })
        })
        .collect())
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct UnlockedAchievement {
    pub code: String,
    pub unlocked_at: chrono::DateTime<chrono::Utc>,
    pub category: String,
    pub tier: String,
    pub kind: String,
    pub threshold: i32,
}

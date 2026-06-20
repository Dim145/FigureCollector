//! Free-form "atelier" shelf layout for the Vitrines planner.
//!
//! Stores one opaque JSON document per user — the absolute placement of owned
//! pieces on the planner's drawn shelves. The SPA owns the shape
//! (`{ shelves, placed: { <owned_id>: { shelf, x } } }`); the server just
//! persists and returns it verbatim, upserted wholesale on each save. It never
//! feeds stats or any other query, so there's nothing to validate or invalidate.

use crate::error::AppResult;
use serde_json::{Value, json};
use sqlx::PgPool;
use uuid::Uuid;

pub async fn get(pool: &PgPool, user_id: Uuid) -> AppResult<Value> {
    let row: Option<(Value,)> =
        sqlx::query_as("SELECT data FROM collection_layouts WHERE user_id = $1")
            .bind(user_id)
            .fetch_optional(pool)
            .await?;
    Ok(row.map(|(v,)| v).unwrap_or_else(|| json!({})))
}

pub async fn put(pool: &PgPool, user_id: Uuid, data: Value) -> AppResult<()> {
    sqlx::query(
        "INSERT INTO collection_layouts (user_id, data, updated_at)
         VALUES ($1, $2, now())
         ON CONFLICT (user_id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()",
    )
    .bind(user_id)
    .bind(data)
    .execute(pool)
    .await?;
    Ok(())
}

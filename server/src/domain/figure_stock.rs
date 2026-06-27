//! Per-shop stock availability (`figure_shop_stock`).
//!
//! The price cron resolves a stock signal for each (figure, store) buy-link it
//! visits — from orzgk's WooCommerce variations JSON or the proxy's optional
//! `status` field — and records it here. The figure-detail "Boutiques" section
//! and the shop page read it via a LEFT JOIN (see [`crate::domain::store`]).
//!
//! Modelling rule: only the three KNOWN states are ever stored. A missing row
//! means "unknown", and the UI then makes no stock claim (keeps the normal
//! "Acheter" button). So a recheck that yields no signal must [`clear`] any
//! prior row rather than leave a stale one.
//!
//! Freshness: reads (see [`crate::domain::store`]) only surface a row whose
//! `checked_at` is within the last 7 days. A listing that STOPS refreshing —
//! its page 404s or the item is delisted, so the cron's fetch errors and can
//! neither upsert nor clear — therefore ages back to "unknown" rather than
//! keeping a stale badge.

use crate::error::AppResult;
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use uuid::Uuid;

/// A resolved per-shop availability. Serialised snake_case to match the API
/// strings the SPA switches on (`in_stock` / `out_of_stock` / `preorder`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StockStatus {
    InStock,
    OutOfStock,
    Preorder,
}

impl StockStatus {
    /// The DB / API string for this status.
    pub fn as_db(self) -> &'static str {
        match self {
            Self::InStock => "in_stock",
            Self::OutOfStock => "out_of_stock",
            Self::Preorder => "preorder",
        }
    }

    /// Map orzgk's WooCommerce `stock_status` vocab → our enum.
    /// `instock` → in stock, `onbackorder` → preorder (billed before shipping),
    /// `outofstock` → out of stock. Anything else → `None` (unknown).
    pub fn from_woocommerce(s: &str) -> Option<Self> {
        match s.trim().to_ascii_lowercase().as_str() {
            "instock" | "in_stock" | "in stock" => Some(Self::InStock),
            "onbackorder" | "on_backorder" | "backorder" | "preorder" | "pre_order"
            | "pre-order" => Some(Self::Preorder),
            "outofstock" | "out_of_stock" | "out of stock" | "sold_out" | "soldout" => {
                Some(Self::OutOfStock)
            }
            _ => None,
        }
    }
}

/// Upsert a known per-shop status, refreshing `checked_at` to now.
pub async fn upsert(
    pool: &PgPool,
    figure_id: Uuid,
    store_id: Uuid,
    status: StockStatus,
    source: &str,
) -> AppResult<()> {
    sqlx::query(
        "INSERT INTO figure_shop_stock (figure_id, store_id, status, source, checked_at)
         VALUES ($1, $2, $3, $4, now())
         ON CONFLICT (figure_id, store_id) DO UPDATE
             SET status = EXCLUDED.status, source = EXCLUDED.source, checked_at = now()",
    )
    .bind(figure_id)
    .bind(store_id)
    .bind(status.as_db())
    .bind(source)
    .execute(pool)
    .await?;
    Ok(())
}

/// Drop a per-shop row — used when the latest check found no signal, so the
/// pair reverts to "unknown" instead of showing a stale status. Returns the
/// number of rows removed (0 when there was nothing to clear).
pub async fn clear(pool: &PgPool, figure_id: Uuid, store_id: Uuid) -> AppResult<u64> {
    let res = sqlx::query("DELETE FROM figure_shop_stock WHERE figure_id = $1 AND store_id = $2")
        .bind(figure_id)
        .bind(store_id)
        .execute(pool)
        .await?;
    Ok(res.rows_affected())
}

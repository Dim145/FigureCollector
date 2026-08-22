//! Notifications — multi-channel pipeline.
//!
//! ## Event model
//!
//! An event is a domain occurrence the user might care about — an
//! achievement unlocked, a preorder release date arriving, a J-7 reminder.
//! Events have a stable string ID (`event_type`) and a JSON payload with
//! all the bits the frontend needs to render a localised message:
//!
//!   - `achievement_unlocked` → `{ code, tier, category, figure_id?, figure_name? }`
//!   - `preorder_release_today` → `{ preorder_id, figure_id, figure_name, release_date }`
//!   - `preorder_release_j7`   → `{ preorder_id, figure_id, figure_name, release_date }`
//!
//! ## Dispatch
//!
//! Every event drops a row into `notifications` so the in-app bell + the
//! `/notifications` page always have a complete history. THEN, for each
//! external channel where the user has both subscribed AND routed this
//! event, we hand the payload off to the channel adapter (email / ntfy /
//! webhook / apprise / web push). Adapters are best-effort — a failed
//! channel doesn't roll back the in-app row.
//!
//! ## Concurrency
//!
//! `dispatch_*` returns `Vec<Notification>` so the caller can push a
//! WebSocket "new notification" event to live the UI. External channel
//! fan-out happens in a `tokio::spawn` so the originating request returns
//! immediately.

use crate::error::AppResult;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, PgPool};
use uuid::Uuid;

// =============================================================================
// Event types — stable string IDs the frontend uses to format messages.
// =============================================================================

pub const EVENT_ACHIEVEMENT_UNLOCKED: &str = "achievement_unlocked";
pub const EVENT_PREORDER_RELEASE_TODAY: &str = "preorder_release_today";
pub const EVENT_PREORDER_RELEASE_J7: &str = "preorder_release_j7";
/// Fires when a shipped preorder's projected delivery date (shipped_at +
/// estimated_delivery_days) equals today, ONCE per (preorder_id, date).
pub const EVENT_PREORDER_DELIVERY_TODAY: &str = "preorder_delivery_today";
/// Fires the day AFTER the projected delivery date when the preorder
/// isn't already marked received. Fires ONCE per preorder.
pub const EVENT_PREORDER_DELIVERY_OVERDUE: &str = "preorder_delivery_overdue";
/// An admin approved a MangaCollector server the user was linked to (was
/// pending) — their integration is now active. Payload: `{ base_url, label? }`.
pub const EVENT_MANGA_SERVER_APPROVED: &str = "manga_server_approved";
/// An admin revoked a MangaCollector server the user was linked to — the
/// integration is disabled until they pick another. Payload:
/// `{ base_url, label?, reason? }`.
pub const EVENT_MANGA_SERVER_REVOKED: &str = "manga_server_revoked";
/// The price cron observed a market price at or under the user's wishlist
/// target for a wished figure. Fires once per (figure, price level) — a
/// further drop re-fires. Payload: `{ figure_id, figure_name, amount,
/// currency, target_amount, target_currency }`.
pub const EVENT_WISHLIST_PRICE_BELOW_TARGET: &str = "wishlist_price_below_target";
/// The price cron saw a shop's stock signal go from a KNOWN out-of-stock to
/// in-stock / preorder for a figure the user wishes. Fires only on a real
/// transition (never on a first-ever observation, which is not a "return"),
/// deduped per (figure, store, day) so a flapping listing can't spam. Payload:
/// `{ figure_id, figure_name, store_id, store_name, status }`.
pub const EVENT_WISHLIST_BACK_IN_STOCK: &str = "wishlist_back_in_stock";
/// A claim window on an arrival condition report is about to close (the shop's
/// DOA window or the carrier's). Fires while there is still time to act —
/// a notice the day after is just bad news. Once per (report, window, date).
/// Payload: `{ report_id, owned_item_id, figure_name, which, deadline, days_left }`.
pub const EVENT_CLAIM_WINDOW_CLOSING: &str = "claim_window_closing";

/// All event types the system can fire. Keep in lockstep with the SPA's
/// i18n message keys (`notifications.event.<event_type>.*`).
pub const ALL_EVENTS: &[&str] = &[
    EVENT_ACHIEVEMENT_UNLOCKED,
    EVENT_PREORDER_RELEASE_TODAY,
    EVENT_PREORDER_RELEASE_J7,
    EVENT_PREORDER_DELIVERY_TODAY,
    EVENT_PREORDER_DELIVERY_OVERDUE,
    EVENT_MANGA_SERVER_APPROVED,
    EVENT_MANGA_SERVER_REVOKED,
    EVENT_WISHLIST_PRICE_BELOW_TARGET,
    EVENT_WISHLIST_BACK_IN_STOCK,
    EVENT_CLAIM_WINDOW_CLOSING,
];

// =============================================================================
// Channel types — stable string IDs matching the `notification_channels`
// table's primary key.
// =============================================================================

/// The always-on in-app channel is virtual — it never appears in
/// `notification_channels` and isn't part of `EXTERNAL_CHANNELS`, but the
/// constant is exported for clarity if future code needs to reference it.
#[allow(dead_code)]
pub const CHANNEL_IN_APP: &str = "in_app";
pub const CHANNEL_BROWSER_PUSH: &str = "browser_push";
pub const CHANNEL_EMAIL: &str = "email";
pub const CHANNEL_NTFY: &str = "ntfy";
pub const CHANNEL_WEBHOOK: &str = "webhook";
pub const CHANNEL_APPRISE: &str = "apprise";

/// All EXTERNAL channels — the ones with rows in `notification_channels`.
/// In-app is virtual (always-on, no config) and isn't in this list.
pub const EXTERNAL_CHANNELS: &[&str] = &[
    CHANNEL_BROWSER_PUSH,
    CHANNEL_EMAIL,
    CHANNEL_NTFY,
    CHANNEL_WEBHOOK,
    CHANNEL_APPRISE,
];

// =============================================================================
// Types
// =============================================================================

/// A single in-app notification row.
#[derive(Debug, Clone, Serialize, FromRow)]
pub struct Notification {
    pub id: Uuid,
    pub user_id: Uuid,
    pub event_type: String,
    pub payload: serde_json::Value,
    pub read_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}

/// System-level channel config row (admin-managed).
#[derive(Debug, Clone, Serialize, FromRow)]
pub struct ChannelConfig {
    pub channel_type: String,
    pub enabled: bool,
    pub config: serde_json::Value,
    pub updated_at: DateTime<Utc>,
}

/// Per-user channel subscription row.
#[derive(Debug, Clone, Serialize, FromRow)]
pub struct UserChannel {
    pub user_id: Uuid,
    pub channel_type: String,
    pub enabled: bool,
    pub destination: serde_json::Value,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Per-user per-event routing row.
#[derive(Debug, Clone, Serialize, FromRow)]
pub struct UserRoute {
    pub user_id: Uuid,
    pub event_type: String,
    pub channel_type: String,
    pub enabled: bool,
}

// =============================================================================
// Bell + page queries
// =============================================================================

/// Default page size for `list_for_user`. The SPA's bell popover uses
/// `limit=8`; the dedicated /notifications page uses 50 with pagination.
#[allow(dead_code)]
pub const DEFAULT_LIST_LIMIT: i64 = 50;

/// List notifications for a user, newest first. `unread_only` filters to
/// `read_at IS NULL`.
pub async fn list_for_user(
    pool: &PgPool,
    user_id: Uuid,
    unread_only: bool,
    limit: i64,
    offset: i64,
) -> AppResult<Vec<Notification>> {
    let limit = limit.clamp(1, 200);
    let offset = offset.max(0);
    let mut sql = String::from(
        "SELECT id, user_id, event_type, payload, read_at, created_at
         FROM notifications
         WHERE user_id = $1",
    );
    if unread_only {
        sql.push_str(" AND read_at IS NULL");
    }
    sql.push_str(" ORDER BY created_at DESC LIMIT $2 OFFSET $3");
    Ok(sqlx::query_as::<_, Notification>(&sql)
        .bind(user_id)
        .bind(limit)
        .bind(offset)
        .fetch_all(pool)
        .await?)
}

/// Quick counts for the bell badge: total + unread.
#[derive(Debug, Clone, Serialize, FromRow)]
pub struct CountsSummary {
    pub total: i64,
    pub unread: i64,
}

pub async fn counts_for_user(pool: &PgPool, user_id: Uuid) -> AppResult<CountsSummary> {
    let row: (i64, i64) = sqlx::query_as(
        "SELECT
            COUNT(*)::bigint AS total,
            COUNT(*) FILTER (WHERE read_at IS NULL)::bigint AS unread
         FROM notifications
         WHERE user_id = $1",
    )
    .bind(user_id)
    .fetch_one(pool)
    .await?;
    Ok(CountsSummary {
        total: row.0,
        unread: row.1,
    })
}

/// Mark a single notification as read. No-ops if the row doesn't belong
/// to the user.
pub async fn mark_read(pool: &PgPool, user_id: Uuid, id: Uuid) -> AppResult<()> {
    sqlx::query(
        "UPDATE notifications SET read_at = now()
         WHERE id = $1 AND user_id = $2 AND read_at IS NULL",
    )
    .bind(id)
    .bind(user_id)
    .execute(pool)
    .await?;
    Ok(())
}

/// Mark every unread notification for the user as read. Returns the
/// number of rows that flipped.
pub async fn mark_all_read(pool: &PgPool, user_id: Uuid) -> AppResult<u64> {
    let res = sqlx::query(
        "UPDATE notifications SET read_at = now()
         WHERE user_id = $1 AND read_at IS NULL",
    )
    .bind(user_id)
    .execute(pool)
    .await?;
    Ok(res.rows_affected())
}

/// Delete a single notification. Used by the SPA's "clear" affordance.
pub async fn delete_one(pool: &PgPool, user_id: Uuid, id: Uuid) -> AppResult<()> {
    sqlx::query("DELETE FROM notifications WHERE id = $1 AND user_id = $2")
        .bind(id)
        .bind(user_id)
        .execute(pool)
        .await?;
    Ok(())
}

// =============================================================================
// Channel registry queries
// =============================================================================

/// Every system-level channel row. Admin page consumes this.
pub async fn list_channels(pool: &PgPool) -> AppResult<Vec<ChannelConfig>> {
    Ok(sqlx::query_as::<_, ChannelConfig>(
        "SELECT channel_type, enabled, config, updated_at FROM notification_channels
         ORDER BY channel_type",
    )
    .fetch_all(pool)
    .await?)
}

/// Single channel row. Used by adapters to look up their config.
pub async fn get_channel(pool: &PgPool, channel_type: &str) -> AppResult<Option<ChannelConfig>> {
    Ok(sqlx::query_as::<_, ChannelConfig>(
        "SELECT channel_type, enabled, config, updated_at FROM notification_channels
         WHERE channel_type = $1",
    )
    .bind(channel_type)
    .fetch_optional(pool)
    .await?)
}

/// Admin: enable/disable + replace config for a channel.
pub async fn update_channel(
    pool: &PgPool,
    channel_type: &str,
    enabled: Option<bool>,
    config: Option<serde_json::Value>,
) -> AppResult<ChannelConfig> {
    Ok(sqlx::query_as::<_, ChannelConfig>(
        "UPDATE notification_channels SET
            enabled    = COALESCE($2, enabled),
            config     = COALESCE($3, config),
            updated_at = now()
         WHERE channel_type = $1
         RETURNING channel_type, enabled, config, updated_at",
    )
    .bind(channel_type)
    .bind(enabled)
    .bind(config)
    .fetch_one(pool)
    .await?)
}

// =============================================================================
// User channel subscriptions
// =============================================================================

pub async fn list_user_channels(pool: &PgPool, user_id: Uuid) -> AppResult<Vec<UserChannel>> {
    Ok(sqlx::query_as::<_, UserChannel>(
        "SELECT user_id, channel_type, enabled, destination, created_at, updated_at
         FROM user_notification_channels
         WHERE user_id = $1",
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?)
}

pub async fn upsert_user_channel(
    pool: &PgPool,
    user_id: Uuid,
    channel_type: &str,
    enabled: Option<bool>,
    destination: Option<serde_json::Value>,
) -> AppResult<UserChannel> {
    // INSERT … ON CONFLICT … so the first save creates the row.
    Ok(sqlx::query_as::<_, UserChannel>(
        "INSERT INTO user_notification_channels
            (user_id, channel_type, enabled, destination)
         VALUES ($1, $2, COALESCE($3, FALSE), COALESCE($4, '{}'::jsonb))
         ON CONFLICT (user_id, channel_type) DO UPDATE SET
            enabled     = COALESCE($3, user_notification_channels.enabled),
            destination = COALESCE($4, user_notification_channels.destination),
            updated_at  = now()
         RETURNING user_id, channel_type, enabled, destination, created_at, updated_at",
    )
    .bind(user_id)
    .bind(channel_type)
    .bind(enabled)
    .bind(destination)
    .fetch_one(pool)
    .await?)
}

// =============================================================================
// Per-user per-event routing
// =============================================================================

pub async fn list_user_routes(pool: &PgPool, user_id: Uuid) -> AppResult<Vec<UserRoute>> {
    Ok(sqlx::query_as::<_, UserRoute>(
        "SELECT user_id, event_type, channel_type, enabled
         FROM user_notification_routes
         WHERE user_id = $1",
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?)
}

#[derive(Debug, Deserialize)]
pub struct RouteUpdate {
    pub event_type: String,
    pub channel_type: String,
    pub enabled: bool,
}

/// Bulk upsert — the SPA sends the full matrix.
pub async fn upsert_user_routes(
    pool: &PgPool,
    user_id: Uuid,
    updates: &[RouteUpdate],
) -> AppResult<()> {
    let mut tx = pool.begin().await?;
    for u in updates {
        sqlx::query(
            "INSERT INTO user_notification_routes
                (user_id, event_type, channel_type, enabled)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (user_id, event_type, channel_type) DO UPDATE SET
                enabled = EXCLUDED.enabled",
        )
        .bind(user_id)
        .bind(&u.event_type)
        .bind(&u.channel_type)
        .bind(u.enabled)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    Ok(())
}

/// Returns the set of (channel_type, destination, system_config) tuples
/// that should receive `event_type` for `user_id`. Excludes channels that
/// the admin hasn't enabled at the system level OR that the user hasn't
/// configured. This is the canonical "fan-out" query the dispatcher
/// consults before invoking adapters.
pub async fn resolve_routes(
    pool: &PgPool,
    user_id: Uuid,
    event_type: &str,
) -> AppResult<Vec<RouteResolved>> {
    Ok(sqlx::query_as::<_, RouteResolved>(
        "SELECT
            unc.channel_type    AS channel_type,
            unc.destination     AS destination,
            nc.config           AS system_config
         FROM user_notification_channels unc
         JOIN notification_channels      nc  ON nc.channel_type = unc.channel_type
         LEFT JOIN user_notification_routes unr
                ON unr.user_id = unc.user_id
               AND unr.channel_type = unc.channel_type
               AND unr.event_type = $2
         WHERE unc.user_id = $1
           AND unc.enabled = TRUE
           AND nc.enabled  = TRUE
           AND COALESCE(unr.enabled, TRUE) = TRUE",
    )
    .bind(user_id)
    .bind(event_type)
    .fetch_all(pool)
    .await?)
}

#[derive(Debug, Clone, FromRow)]
pub struct RouteResolved {
    pub channel_type: String,
    pub destination: serde_json::Value,
    pub system_config: serde_json::Value,
}

// =============================================================================
// Dedup
// =============================================================================

/// Records a dedup token inside an outer transaction; returns true if it
/// was newly inserted (caller should dispatch), false if it already
/// existed (caller should skip). The dispatcher pairs this with
/// `record_tx` in a single tx so a crash between the two writes can't
/// leave a dedup row blocking every future retry of the same event.
pub async fn try_mark_sent_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    user_id: Uuid,
    event_type: &str,
    dedup_key: &str,
) -> AppResult<bool> {
    let res = sqlx::query(
        "INSERT INTO notification_dedup (user_id, event_type, dedup_key)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id, event_type, dedup_key) DO NOTHING",
    )
    .bind(user_id)
    .bind(event_type)
    .bind(dedup_key)
    .execute(&mut **tx)
    .await?;
    Ok(res.rows_affected() > 0)
}

// =============================================================================
// Dispatcher — the heart of the system
// =============================================================================

/// Drops a row into `notifications` inside an outer transaction. Returns
/// the created notification so the caller can publish a "new notification"
/// event over the WebSocket for live UI updates. Does NOT fan out to
/// external channels — that's the caller's job (typically via
/// `crate::services::notify::dispatch`). Always paired with
/// `try_mark_sent_tx` to keep dedup + in-app row atomic.
pub async fn record_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    user_id: Uuid,
    event_type: &str,
    payload: serde_json::Value,
) -> AppResult<Notification> {
    let id = Uuid::now_v7();
    Ok(sqlx::query_as::<_, Notification>(
        "INSERT INTO notifications (id, user_id, event_type, payload)
         VALUES ($1, $2, $3, $4)
         RETURNING id, user_id, event_type, payload, read_at, created_at",
    )
    .bind(id)
    .bind(user_id)
    .bind(event_type)
    .bind(payload)
    .fetch_one(&mut **tx)
    .await?)
}

// =============================================================================
// Notification preferences (Lot 6) — do-not-disturb preset + quiet hours.
// Gate EXTERNAL delivery only; the in-app row (journal) is always written.
// =============================================================================

/// Events that pierce the `essential` preset and quiet hours.
pub const CRITICAL_EVENTS: &[&str] = &[
    EVENT_PREORDER_RELEASE_TODAY,
    EVENT_PREORDER_DELIVERY_TODAY,
    EVENT_PREORDER_DELIVERY_OVERDUE,
];

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct NotifPrefs {
    pub notification_preset: String,
    pub quiet_hours_enabled: bool,
    pub quiet_hours_start: i16,
    pub quiet_hours_end: i16,
}

impl Default for NotifPrefs {
    fn default() -> Self {
        Self {
            notification_preset: "all".into(),
            quiet_hours_enabled: false,
            quiet_hours_start: 22,
            quiet_hours_end: 8,
        }
    }
}

impl NotifPrefs {
    /// Whether `hour` (0–23) is inside the quiet window [start, end), wrapping
    /// midnight. An empty window (start == end) is never active.
    pub fn quiet_active(&self, hour: i16) -> bool {
        if !self.quiet_hours_enabled {
            return false;
        }
        let (s, e) = (self.quiet_hours_start, self.quiet_hours_end);
        if s == e {
            false
        } else if s < e {
            hour >= s && hour < e
        } else {
            hour >= s || hour < e
        }
    }

    /// Whether `event_type` may reach EXTERNAL channels at `hour` under this
    /// preset + quiet-hours config. Critical events pierce both gates.
    pub fn allows_external(&self, event_type: &str, hour: i16) -> bool {
        if matches!(self.notification_preset.as_str(), "in_app" | "silent") {
            return false;
        }
        let critical = CRITICAL_EVENTS.contains(&event_type);
        if self.notification_preset == "essential" && !critical {
            return false;
        }
        if self.quiet_active(hour) && !critical {
            return false;
        }
        true
    }

    /// `silent` records the in-app row already-read (no unread badge).
    pub fn silences_inapp(&self) -> bool {
        self.notification_preset == "silent"
    }
}

pub async fn user_prefs(pool: &PgPool, user_id: Uuid) -> AppResult<NotifPrefs> {
    Ok(sqlx::query_as::<_, NotifPrefs>(
        "SELECT notification_preset, quiet_hours_enabled, quiet_hours_start, quiet_hours_end
         FROM users WHERE id = $1",
    )
    .bind(user_id)
    .fetch_one(pool)
    .await?)
}

#[derive(Debug, serde::Deserialize)]
pub struct NotifPrefsPatch {
    #[serde(default)]
    pub notification_preset: Option<String>,
    #[serde(default)]
    pub quiet_hours_enabled: Option<bool>,
    #[serde(default)]
    pub quiet_hours_start: Option<i16>,
    #[serde(default)]
    pub quiet_hours_end: Option<i16>,
}

pub async fn update_prefs(
    pool: &PgPool,
    user_id: Uuid,
    p: NotifPrefsPatch,
) -> AppResult<NotifPrefs> {
    if let Some(ref pr) = p.notification_preset {
        if !matches!(pr.as_str(), "all" | "essential" | "in_app" | "silent") {
            return Err(crate::error::AppError::BadRequest(
                "notification_preset must be all, essential, in_app or silent",
            ));
        }
    }
    for h in [p.quiet_hours_start, p.quiet_hours_end].into_iter().flatten() {
        if !(0..=23).contains(&h) {
            return Err(crate::error::AppError::BadRequest("quiet hour must be 0–23"));
        }
    }
    Ok(sqlx::query_as::<_, NotifPrefs>(
        "UPDATE users SET
            notification_preset = COALESCE($1, notification_preset),
            quiet_hours_enabled = COALESCE($2, quiet_hours_enabled),
            quiet_hours_start   = COALESCE($3, quiet_hours_start),
            quiet_hours_end     = COALESCE($4, quiet_hours_end)
         WHERE id = $5
         RETURNING notification_preset, quiet_hours_enabled, quiet_hours_start, quiet_hours_end",
    )
    .bind(p.notification_preset)
    .bind(p.quiet_hours_enabled)
    .bind(p.quiet_hours_start)
    .bind(p.quiet_hours_end)
    .bind(user_id)
    .fetch_one(pool)
    .await?)
}

// =============================================================================
// Web Push subscriptions
// =============================================================================

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct PushSubscription {
    pub id: Uuid,
    pub user_id: Uuid,
    pub endpoint: String,
    pub p256dh: String,
    pub auth: String,
    pub user_agent: Option<String>,
    pub created_at: DateTime<Utc>,
}

pub async fn register_push(
    pool: &PgPool,
    user_id: Uuid,
    endpoint: &str,
    p256dh: &str,
    auth: &str,
    user_agent: Option<&str>,
) -> AppResult<PushSubscription> {
    let id = Uuid::now_v7();
    Ok(sqlx::query_as::<_, PushSubscription>(
        "INSERT INTO web_push_subscriptions
            (id, user_id, endpoint, p256dh, auth, user_agent)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (user_id, endpoint) DO UPDATE SET
            p256dh     = EXCLUDED.p256dh,
            auth       = EXCLUDED.auth,
            user_agent = EXCLUDED.user_agent
         RETURNING id, user_id, endpoint, p256dh, auth, user_agent, created_at",
    )
    .bind(id)
    .bind(user_id)
    .bind(endpoint)
    .bind(p256dh)
    .bind(auth)
    .bind(user_agent)
    .fetch_one(pool)
    .await?)
}

pub async fn list_push_subs(pool: &PgPool, user_id: Uuid) -> AppResult<Vec<PushSubscription>> {
    Ok(sqlx::query_as::<_, PushSubscription>(
        "SELECT id, user_id, endpoint, p256dh, auth, user_agent, created_at
         FROM web_push_subscriptions
         WHERE user_id = $1",
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?)
}

pub async fn delete_push(pool: &PgPool, user_id: Uuid, id: Uuid) -> AppResult<()> {
    sqlx::query("DELETE FROM web_push_subscriptions WHERE id = $1 AND user_id = $2")
        .bind(id)
        .bind(user_id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn delete_push_by_endpoint(
    pool: &PgPool,
    user_id: Uuid,
    endpoint: &str,
) -> AppResult<()> {
    sqlx::query("DELETE FROM web_push_subscriptions WHERE user_id = $1 AND endpoint = $2")
        .bind(user_id)
        .bind(endpoint)
        .execute(pool)
        .await?;
    Ok(())
}

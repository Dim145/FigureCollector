-- =============================================================================
-- 17) Notifications system
--
-- A multi-channel notification pipeline:
--   * Admin configures system-level channel secrets (SMTP server, ntfy server
--     URL + auth, VAPID keys, Apprise URL …) in `notification_channels`.
--   * Each user opts into the channels the admin has enabled and provides
--     their *destination* (their email address, their ntfy topic, their
--     webhook URL, their VAPID push endpoint) in `user_notification_channels`.
--   * `user_notification_routes` maps event types to channels per user —
--     so a user can pick which events go where (e.g. achievements only
--     in-app, J-7 release reminder on email + push, etc.).
--   * `notifications` is the always-on in-app log — every event drops a
--     row here regardless of external-channel routing. The bell + the
--     /notifications page read from this table.
--   * `web_push_subscriptions` is one row per registered device so users
--     can subscribe from multiple browsers/devices.
-- =============================================================================

-- ----- System-level channel config (admin-managed) ---------------------------
CREATE TABLE IF NOT EXISTS notification_channels (
    channel_type TEXT        PRIMARY KEY,
    enabled      BOOLEAN     NOT NULL DEFAULT FALSE,
    config       JSONB       NOT NULL DEFAULT '{}'::jsonb,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed the registry so the admin page renders even before anything's
-- configured. Each row's `enabled` stays FALSE until the admin explicitly
-- flips it on (and supplies the required `config` JSON).
INSERT INTO notification_channels (channel_type) VALUES
    ('browser_push'),
    ('email'),
    ('ntfy'),
    ('webhook'),
    ('apprise')
ON CONFLICT (channel_type) DO NOTHING;

-- ----- Per-user channel subscriptions (destinations) --------------------------
CREATE TABLE IF NOT EXISTS user_notification_channels (
    user_id      UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel_type TEXT        NOT NULL REFERENCES notification_channels(channel_type) ON DELETE CASCADE,
    enabled      BOOLEAN     NOT NULL DEFAULT FALSE,
    destination  JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, channel_type)
);

-- ----- Per-user per-event routing ---------------------------------------------
-- Which events does this user want delivered through which channels?
-- The in_app channel is always-on (we don't store rows for it; the
-- `notifications` log is unconditional).
CREATE TABLE IF NOT EXISTS user_notification_routes (
    user_id      UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    event_type   TEXT        NOT NULL,
    channel_type TEXT        NOT NULL REFERENCES notification_channels(channel_type) ON DELETE CASCADE,
    enabled      BOOLEAN     NOT NULL DEFAULT TRUE,
    PRIMARY KEY (user_id, event_type, channel_type)
);

-- ----- In-app notification log (the bell + /notifications page) --------------
CREATE TABLE IF NOT EXISTS notifications (
    id          UUID        PRIMARY KEY,
    user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    event_type  TEXT        NOT NULL,
    -- Structured payload — figure_id, figure_name, achievement_code, etc.
    -- The frontend formats the human-readable string using i18n.
    payload     JSONB       NOT NULL DEFAULT '{}'::jsonb,
    read_at     TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notifications_user_idx
    ON notifications (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS notifications_unread_idx
    ON notifications (user_id, created_at DESC)
    WHERE read_at IS NULL;

-- ----- Web Push subscriptions -------------------------------------------------
-- One row per (user, browser/device). Stored separately from
-- user_notification_channels because a user can subscribe from several
-- browsers and we need all endpoints when fanning out a push.
CREATE TABLE IF NOT EXISTS web_push_subscriptions (
    id          UUID        PRIMARY KEY,
    user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    endpoint    TEXT        NOT NULL,
    p256dh      TEXT        NOT NULL,
    auth        TEXT        NOT NULL,
    user_agent  TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, endpoint)
);

-- Idempotency for the J-7 / J-day cron — we don't want to spam the user
-- if the worker reruns on the same day for whatever reason.
CREATE TABLE IF NOT EXISTS notification_dedup (
    user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    event_type    TEXT NOT NULL,
    dedup_key     TEXT NOT NULL,
    sent_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, event_type, dedup_key)
);

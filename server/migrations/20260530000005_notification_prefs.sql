-- =============================================================================
-- Lot 6 — Notification presets: quiet hours + a do-not-disturb preset.
--
-- These gate EXTERNAL channel delivery only — the in-app row (the journal) is
-- always written. `notification_preset`:
--   all       → every event to every routed channel
--   essential → only critical events (release-today / delivery-today /
--               delivery-overdue) reach external channels
--   in_app    → nothing external; in-app stays unread (badge)
--   silent    → nothing external; in-app written already-read (no badge)
--
-- Quiet hours suppress external delivery during [start, end) (wrapping
-- midnight), except critical events which pierce. Hours are whole-hour,
-- evaluated against the server clock.
-- =============================================================================

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS notification_preset TEXT NOT NULL DEFAULT 'all'
        CHECK (notification_preset IN ('all', 'essential', 'in_app', 'silent')),
    ADD COLUMN IF NOT EXISTS quiet_hours_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS quiet_hours_start SMALLINT NOT NULL DEFAULT 22
        CHECK (quiet_hours_start BETWEEN 0 AND 23),
    ADD COLUMN IF NOT EXISTS quiet_hours_end SMALLINT NOT NULL DEFAULT 8
        CHECK (quiet_hours_end BETWEEN 0 AND 23);

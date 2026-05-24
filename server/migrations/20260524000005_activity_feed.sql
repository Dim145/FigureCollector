-- =============================================================================
-- FigureCollector — Phase 3B: activity feed
--
-- Per-user log of meaningful events. Each row carries a denormalised JSONB
-- snapshot so the feed renders the figure name / manufacturer as they were
-- at the time, even if the underlying record is renamed or deleted later.
--
-- `kind` is a free-text discriminator validated in the application layer:
--   owned_added, owned_removed,
--   preorder_created, preorder_status_changed, preorder_slipped,
--   preorder_received, profile_visibility_changed.
-- =============================================================================

CREATE TABLE IF NOT EXISTS activity_events (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind        TEXT        NOT NULL,
    payload     JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS activity_events_user_recent_idx
    ON activity_events (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS activity_events_kind_idx
    ON activity_events (kind);

-- Partial index for the year-in-review hot path: filtering events of a user
-- within a specific calendar year goes through (user_id, created_at).
-- The recent index above already serves this; no extra index needed.

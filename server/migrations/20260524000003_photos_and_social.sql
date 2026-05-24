-- =============================================================================
-- FigureCollector — Phase 2B + Phase 3
-- =============================================================================

-- ---- photos -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS photos (
    id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    owned_item_id   UUID         NOT NULL REFERENCES owned_items(id) ON DELETE CASCADE,
    storage_key     TEXT         NOT NULL UNIQUE,
    mime            TEXT         NOT NULL,
    width           INTEGER      NOT NULL,
    height          INTEGER      NOT NULL,
    size_bytes      BIGINT       NOT NULL,
    position        INTEGER      NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS photos_owned_item_idx ON photos (owned_item_id, position);

-- ---- Phase 3: opt-in public profile ----------------------------------------
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS public_profile_enabled BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS users_public_profile_idx
    ON users (LOWER(username))
    WHERE public_profile_enabled = TRUE;

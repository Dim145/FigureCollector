-- =============================================================================
-- FigureCollector — Phase 2B + Phase 3
--   - photos      : user-uploaded images tied to owned_items
--   - users gains `public_profile_enabled` for Phase 3 (opt-in public profile)
-- =============================================================================

-- ---- photos -----------------------------------------------------------------
CREATE TABLE photos (
    id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    owned_item_id   UUID         NOT NULL REFERENCES owned_items(id) ON DELETE CASCADE,
    storage_key     TEXT         NOT NULL UNIQUE,         -- key inside the Garage bucket
    mime            TEXT         NOT NULL,
    width           INTEGER      NOT NULL,
    height          INTEGER      NOT NULL,
    size_bytes      BIGINT       NOT NULL,
    position        INTEGER      NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX photos_owned_item_idx ON photos (owned_item_id, position);

-- ---- Phase 3: opt-in public profile ----------------------------------------
ALTER TABLE users
    ADD COLUMN public_profile_enabled BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX users_public_profile_idx
    ON users (LOWER(username))
    WHERE public_profile_enabled = TRUE;

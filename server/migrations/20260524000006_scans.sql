-- =============================================================================
-- FigureCollector — Phase 5A: turntable scans
--
-- A "scan" groups N frames stored in Garage under a shared `storage_prefix`.
-- Phase 5A only writes scans of `kind = 'turntable'` (read back as a 360°
-- photo sequence). Phase 5B will reuse the same table for `kind = 'gsplat'`,
-- adding `state` transitions (pending → processing → ready / failed) and
-- `result_key` pointing at a generated .splat / .ply asset.
-- =============================================================================

CREATE TABLE IF NOT EXISTS scans (
    id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    owned_item_id   UUID         NOT NULL REFERENCES owned_items(id) ON DELETE CASCADE,
    kind            TEXT         NOT NULL DEFAULT 'turntable'
                    CHECK (kind IN ('turntable', 'gsplat')),
    state           TEXT         NOT NULL DEFAULT 'ready'
                    CHECK (state IN ('pending', 'processing', 'ready', 'failed')),
    storage_prefix  TEXT         NOT NULL UNIQUE,
    frame_count     INTEGER      NOT NULL DEFAULT 0,
    result_key      TEXT,                            -- Phase 5B: pointer to .splat / .ply
    error_message   TEXT,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS scans_owned_item_idx ON scans (owned_item_id, created_at DESC);
CREATE INDEX IF NOT EXISTS scans_state_idx      ON scans (state) WHERE state IN ('pending', 'processing');

CREATE OR REPLACE TRIGGER scans_updated_at
    BEFORE UPDATE ON scans
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

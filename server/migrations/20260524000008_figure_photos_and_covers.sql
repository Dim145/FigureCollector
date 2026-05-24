-- =============================================================================
-- 8) Catalog photos (shared) + collection cover preferences (per-user)
--
-- Two distinct concerns, deliberately split:
--   * `figure_photos`  — uploaded by the figure's creator or any admin;
--     shared across every user looking at the catalog (think AniList/MFC
--     image but hosted on our own Garage).
--   * `owned_items.cover_photo_id` / `cover_scan_id` — per-user opt-in cover
--     for the user's grid. Always points at the user's *own* photos/scans;
--     never at a catalog photo (a catalog photo can already be inferred as
--     the fallback, no need to denormalise).
-- =============================================================================

-- ---- figure_photos ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS figure_photos (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    figure_id     UUID        NOT NULL REFERENCES figures(id) ON DELETE CASCADE,
    storage_key   TEXT        NOT NULL UNIQUE,
    mime          TEXT        NOT NULL,
    width         INT         NOT NULL,
    height        INT         NOT NULL,
    size_bytes    BIGINT      NOT NULL,
    position      INT         NOT NULL DEFAULT 0,
    uploaded_by   UUID        REFERENCES users(id) ON DELETE SET NULL,
    is_primary    BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS figure_photos_figure_idx
    ON figure_photos (figure_id, position);

-- At most one primary photo per figure.
CREATE UNIQUE INDEX IF NOT EXISTS figure_photos_primary_idx
    ON figure_photos (figure_id)
    WHERE is_primary;

-- ---- owned_items cover preferences ------------------------------------------
ALTER TABLE owned_items
    ADD COLUMN IF NOT EXISTS cover_photo_id UUID
        REFERENCES photos(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS cover_scan_id  UUID
        REFERENCES scans(id)  ON DELETE SET NULL;

-- Cover is either a photo OR a scan, never both. Wrap in DO so re-running
-- doesn't error on duplicate constraint definition.
DO $$
BEGIN
    ALTER TABLE owned_items
        ADD CONSTRAINT owned_items_single_cover
        CHECK (NOT (cover_photo_id IS NOT NULL AND cover_scan_id IS NOT NULL));
EXCEPTION WHEN duplicate_object THEN
    NULL;
END $$;

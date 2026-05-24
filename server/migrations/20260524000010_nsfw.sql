-- =============================================================================
-- 10) NSFW catalog tag + per-user visibility preference
--
-- Two pieces:
--   * `figures.is_nsfw` (BOOLEAN) — catalog-side flag set by admin/creator.
--   * `users.nsfw_visibility` (TEXT enum) — `hide` (default, filters NSFW
--     out of browse/collection), `blur` (display blurred, refuse uploads),
--     `show` (no special handling).
-- =============================================================================

ALTER TABLE figures
    ADD COLUMN IF NOT EXISTS is_nsfw BOOLEAN NOT NULL DEFAULT FALSE;

-- Partial index — most figures aren't NSFW, only the flagged rows need to be
-- found fast (e.g. when the upload-block check runs).
CREATE INDEX IF NOT EXISTS figures_nsfw_idx
    ON figures (is_nsfw) WHERE is_nsfw;

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS nsfw_visibility TEXT NOT NULL DEFAULT 'hide';

DO $$
BEGIN
    ALTER TABLE users
        ADD CONSTRAINT users_nsfw_visibility_chk
        CHECK (nsfw_visibility IN ('hide','blur','show'));
EXCEPTION WHEN duplicate_object THEN
    NULL;
END $$;

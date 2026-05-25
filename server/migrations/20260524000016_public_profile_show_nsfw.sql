-- =============================================================================
-- 16) Public profile — show-NSFW preference
--
-- When a user opens their collection to the world (public_profile_enabled),
-- they may not want NSFW pieces to surface on /u/{slug}. This column lets
-- them keep the public view clean while NSFW stays visible in their own
-- private vitrine. Defaults to FALSE so opening a profile to the public is
-- always conservative by default.
-- =============================================================================

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS public_profile_show_nsfw BOOLEAN NOT NULL DEFAULT FALSE;

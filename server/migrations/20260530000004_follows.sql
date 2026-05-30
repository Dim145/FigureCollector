-- =============================================================================
-- Lot 4 — Social: same-instance follow graph + opt-in public collection value
--
-- A directed follow edge (follower → followee). Both endpoints cascade with
-- the user. The self-follow guard keeps the graph honest; the two indexes
-- serve the two list directions — "X's followers" (followee_id) and "who X
-- follows" (follower_id) — and back the counts shown on profiles.
--
-- public_profile_show_value mirrors public_profile_show_nsfw: exposing your
-- collection's monetary value (La Cote) to other collectors is opt-in and
-- OFF by default, so opening a profile never leaks value unintentionally.
-- =============================================================================

CREATE TABLE IF NOT EXISTS follows (
    follower_id  UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    followee_id  UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (follower_id, followee_id),
    CONSTRAINT follows_no_self CHECK (follower_id <> followee_id)
);

CREATE INDEX IF NOT EXISTS follows_followee_idx ON follows (followee_id, created_at DESC);
CREATE INDEX IF NOT EXISTS follows_follower_idx ON follows (follower_id, created_at DESC);

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS public_profile_show_value BOOLEAN NOT NULL DEFAULT FALSE;

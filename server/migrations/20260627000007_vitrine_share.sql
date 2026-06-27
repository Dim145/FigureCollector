-- Public vitrine (display cabinet) sharing.
--
-- An owner mints a `share_token` on one of their `collection_locations`
-- (cabinets); anyone with the resulting /v/<token> link can browse that
-- cabinet's pieces read-only — no account, no edit, no reservation. This
-- mirrors the gift-list share (`users.gift_share_token`): the token is the
-- only credential, and the owner's public-profile NSFW / value switches are
-- the hard ceiling on what the public view exposes (enforced in the route
-- layer, not here).

ALTER TABLE collection_locations ADD COLUMN IF NOT EXISTS share_token TEXT;

-- Unique so a token resolves to exactly one cabinet; partial so the many NULLs
-- (sharing off) never collide.
CREATE UNIQUE INDEX IF NOT EXISTS collection_locations_share_token_key
    ON collection_locations (share_token) WHERE share_token IS NOT NULL;

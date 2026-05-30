-- Public gift-list sharing.
--
-- An owner mints `gift_share_token`; anyone with the resulting /g/<token> link
-- can claim ("reserve") a wished figure so several gift-givers don't buy the
-- same thing. Reservations are hidden from the owner to keep the surprise —
-- that rule lives in the route layer, not here.

ALTER TABLE users ADD COLUMN IF NOT EXISTS gift_share_token TEXT;

-- Unique so a token resolves to exactly one owner; partial so the many NULLs
-- (sharing off) never collide.
CREATE UNIQUE INDEX IF NOT EXISTS users_gift_share_token_key
    ON users (gift_share_token) WHERE gift_share_token IS NOT NULL;

CREATE TABLE IF NOT EXISTS gift_reservations (
    id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_user_id  UUID        NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
    figure_id      UUID        NOT NULL REFERENCES figures(id) ON DELETE CASCADE,
    reserver_name  TEXT        NOT NULL,
    -- secret returned once to the giver so only they can release the claim
    reserver_token TEXT        NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- one claim per wished figure (first-come)
    UNIQUE (owner_user_id, figure_id)
);

CREATE INDEX IF NOT EXISTS gift_reservations_owner_idx
    ON gift_reservations (owner_user_id);

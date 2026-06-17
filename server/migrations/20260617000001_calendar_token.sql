-- Calendar feed token — a per-user secret that authorises the public iCal
-- (.ics) subscription of that user's pre-orders
-- (`/api/calendar/<token>/preorders.ics`). A calendar app fetches the feed with
-- no session cookie, so the unguessable token in the URL is the only
-- credential. Mirrors `users.gift_share_token`.

ALTER TABLE users ADD COLUMN IF NOT EXISTS calendar_token TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS users_calendar_token_key
    ON users (calendar_token) WHERE calendar_token IS NOT NULL;

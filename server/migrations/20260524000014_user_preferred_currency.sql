-- Migration 014 — user-preferred default currency
--
-- Default currency for every form that asks for a price (MSRP, owned-item
-- price paid, shipping cost, preorder price). NULL means "no preference,
-- the SPA falls back to its hard-coded default (JPY)".

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS preferred_currency TEXT;

-- Soft constraint: any non-null value should be a 3-letter ISO 4217 code.
-- We don't lock it to a whitelist at the DB level because users may pick
-- niche currencies the SPA hasn't surfaced yet — the server route
-- (`PATCH /api/me/profile`) does enforce the supported list.
ALTER TABLE users
    DROP CONSTRAINT IF EXISTS users_preferred_currency_chk;
ALTER TABLE users
    ADD CONSTRAINT users_preferred_currency_chk
    CHECK (preferred_currency IS NULL OR char_length(preferred_currency) = 3);

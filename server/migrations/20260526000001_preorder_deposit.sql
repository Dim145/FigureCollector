-- Migration 18 — preorder deposit (acompte)
--
-- Preorders on OrzGK & many other shops are split into a deposit paid at
-- order time (e.g. 30 €) and a balance paid before shipping (e.g. 170 €).
-- The deposit is *part of* the total figurine cost — it is deducted from
-- the remaining balance, not added on top.
--
-- We store it on the preorder row (one figurine = one preorder cycle).
-- Always uses `price_currency` for its currency, no separate column —
-- a deposit in a different currency than the balance would make any
-- "% paid vs catalogue" comparison nonsensical.

ALTER TABLE preorders
    ADD COLUMN IF NOT EXISTS deposit_amount NUMERIC(12, 2);

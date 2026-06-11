-- Pricing refonte phase 2 — freeze the FX rate at cost-save time, and
-- normalise the one money-currency column that wasn't CHAR(3).
--
-- 1. owned_items.value_currency was TEXT (every sibling money currency column
--    is CHAR(3)). Normalise it. Existing values are validated 3-letter ISO
--    codes, so the cast is lossless; re-running on an already-CHAR(3) column
--    is a harmless no-op.
--
-- 2. price_fx_rate — the ECB reference rate captured when a COST is recorded:
--    units of the row's price currency per 1 EUR (≈160 for JPY, 1.0 for EUR).
--    Cost converts to EUR as `amount / price_fx_rate`, so a collection's
--    plus-value is computed against what the purchase cost in EUR *at the
--    time* rather than drifting with today's market rate. One column per row
--    covers price + shipping (owned_items) and price + deposit + refund
--    (preorders), since those share the row's price_currency. Nullable: rows
--    saved before this column existed fall back to today's rate at display
--    time (handled server-side in domain::stats).

ALTER TABLE owned_items
    ALTER COLUMN value_currency TYPE CHAR(3) USING value_currency::char(3);

ALTER TABLE owned_items
    ADD COLUMN IF NOT EXISTS price_fx_rate NUMERIC(18, 8);

ALTER TABLE preorders
    ADD COLUMN IF NOT EXISTS price_fx_rate NUMERIC(18, 8);

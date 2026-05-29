-- Per-item current / market value for the "Collection value" feature (Lot 1).
-- Manual valuation lives in `value_amount` (+ its ISO 4217 `value_currency`);
-- when null, the app falls back to the figure's catalog MSRP. NUMERIC(12,2)
-- mirrors price_amount / msrp_amount so every money column shares precision.
ALTER TABLE owned_items
    ADD COLUMN IF NOT EXISTS value_amount   NUMERIC(12, 2),
    ADD COLUMN IF NOT EXISTS value_currency TEXT;

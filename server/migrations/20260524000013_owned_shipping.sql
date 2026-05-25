-- Migration 013 — owned-item shipping cost
--
-- The price the user actually paid is now split into the item cost
-- (`price_amount`, already there) and the shipping cost (`shipping_amount`,
-- new). The shipping currency is implicitly the same as `price_currency` —
-- shipping a figure with a JPY label by a EUR carrier and tracking it
-- correctly is more bookkeeping than this is worth.
--
-- Both columns stay nullable; the total paid is the sum of whichever is set.

ALTER TABLE owned_items
    ADD COLUMN IF NOT EXISTS shipping_amount NUMERIC(12, 2);

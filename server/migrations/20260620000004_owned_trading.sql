-- "À vendre / à échanger" — per-item marketplace flags for the collection.
--
-- A collector can flag an owned piece as for sale and/or for trade, with an
-- optional asking price (in its own currency) and a public sale note. Surfaced
-- as a filter in the collection and an "À vendre" section on the public
-- showcase (/u/{slug}); never shown unless the owner opts in, per item.
ALTER TABLE owned_items
    ADD COLUMN IF NOT EXISTS for_sale              BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS for_trade             BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS asking_price_amount   NUMERIC(12,2),
    ADD COLUMN IF NOT EXISTS asking_price_currency CHAR(3),
    ADD COLUMN IF NOT EXISTS sale_note             TEXT;

-- Partial index: the showcase / "for sale" filter only ever scans listed items.
CREATE INDEX IF NOT EXISTS owned_items_for_sale_idx
    ON owned_items (user_id) WHERE for_sale OR for_trade;

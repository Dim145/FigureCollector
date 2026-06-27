-- Per-shop stock availability for a figure, refreshed by the price cron from
-- orzgk (parsed from the WooCommerce variations JSON) and the proxy (optional
-- `status` field on /product). One row per (figure, store) buy-link.
--
-- Absence of a row means "unknown" — the UI then makes NO stock claim and keeps
-- the normal "Acheter" button. Only the three known states are ever stored, so
-- a row always carries a real signal.
CREATE TABLE IF NOT EXISTS figure_shop_stock (
    figure_id  UUID        NOT NULL REFERENCES figures(id) ON DELETE CASCADE,
    store_id   UUID        NOT NULL REFERENCES stores(id)  ON DELETE CASCADE,
    status     TEXT        NOT NULL CHECK (status IN ('in_stock', 'out_of_stock', 'preorder')),
    -- Provenance of the signal ('orzgk' | 'proxy') — diagnostics only.
    source     TEXT,
    checked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (figure_id, store_id)
);

-- The figure-detail "Boutiques" list joins by the PK prefix (figure_id) — the
-- PK covers it. The shop page joins by store_id, which the figure-first PK does
-- NOT serve, so add a dedicated index for that lookup.
CREATE INDEX IF NOT EXISTS figure_shop_stock_store_idx ON figure_shop_stock (store_id);

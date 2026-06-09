-- Auto-fetched provider / market prices, one row per figure (latest), upserted
-- by the price-refresh cron (services::price_cron). This feeds the "cote"
-- market value as a fallback *under* the user's manual valuation and *above*
-- the catalog MSRP (see domain::stats / domain::owned). An empty table simply
-- means the cron hasn't run yet (or is disabled) — the cote falls back to MSRP.
CREATE TABLE IF NOT EXISTS figure_provider_prices (
    figure_id       UUID PRIMARY KEY REFERENCES figures(id) ON DELETE CASCADE,
    -- Resolved amount + ISO-4217 currency, mirroring every other money column.
    amount          NUMERIC(12, 2) NOT NULL,
    currency        CHAR(3),
    -- The store/provider version label we matched (NULL = no version match, so
    -- the highest reported price was taken).
    matched_version TEXT,
    -- 'orzgk' (native parser) or 'proxy' (operator-configured scraping proxy).
    source          TEXT NOT NULL,
    -- The reconstructed buy-link we scraped, for transparency / debugging.
    source_url      TEXT,
    fetched_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

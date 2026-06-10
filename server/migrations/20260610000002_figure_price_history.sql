-- Append-only history of the provider prices feeding the cote. One row per
-- price *change*: the cron skips a point when the freshly scraped price equals
-- the last recorded one for that figure (change points are enough to chart a
-- step curve, and a daily re-observation of a stable price would otherwise
-- pile up identical rows). `figure_provider_prices` keeps only the latest
-- value (what the cote reads today); this table is what future
-- price-evolution graphs will read.
CREATE TABLE IF NOT EXISTS figure_price_history (
    id              UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
    figure_id       UUID           NOT NULL REFERENCES figures(id) ON DELETE CASCADE,
    amount          NUMERIC(12, 2) NOT NULL,
    currency        CHAR(3),
    -- 'orzgk' (native parser) or 'proxy' (operator-configured scraping proxy).
    source          TEXT           NOT NULL,
    matched_version TEXT,
    recorded_at     TIMESTAMPTZ    NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS figure_price_history_figure_idx
    ON figure_price_history (figure_id, recorded_at DESC);

-- =============================================================================
-- FigureCollector — Phase 2C external lookups cache
-- =============================================================================

CREATE TABLE IF NOT EXISTS external_lookups (
    provider     TEXT        NOT NULL,
    resource     TEXT        NOT NULL,
    key          TEXT        NOT NULL,
    body         JSONB       NOT NULL,
    fetched_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at   TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (provider, resource, key)
);
CREATE INDEX IF NOT EXISTS external_lookups_expires_idx ON external_lookups (expires_at);

-- =============================================================================
-- FigureCollector — Phase 2C external lookups cache
--
-- A single generic cache table for any third-party metadata API (AniList,
-- MFC scraping, Tenji proxy, …). Looking up "anilist:series:163" or
-- "mfc:item:757334" returns the previously fetched JSON if still fresh,
-- otherwise the application layer refetches and upserts.
-- =============================================================================

CREATE TABLE external_lookups (
    provider     TEXT        NOT NULL,
    resource     TEXT        NOT NULL,   -- "series", "item", "character", …
    key          TEXT        NOT NULL,   -- e.g. "163", "757334"
    body         JSONB       NOT NULL,
    fetched_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at   TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (provider, resource, key)
);
CREATE INDEX external_lookups_expires_idx ON external_lookups (expires_at);

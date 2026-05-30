-- Trigram fuzzy matching, used by the wishlist bulk-import "% chance this
-- figure already exists" scorer (name + manufacturer similarity). Enables the
-- similarity() function and the `%` match operator, and indexes figure names
-- so the `%` lookups stay fast as the catalogue grows. Idempotent.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS figures_name_trgm
    ON figures USING gin (lower(name) gin_trgm_ops);

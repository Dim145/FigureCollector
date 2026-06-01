-- MangaCollector synergy: a user links their MangaCollector instance by base
-- URL + public-profile slug. FC reads their public manga library server-side
-- (SSRF-guarded, cached 24h) and joins it to the FC catalogue by MAL id.
--
-- Idempotent — safe to re-run on a DB already carrying these columns.
ALTER TABLE users ADD COLUMN IF NOT EXISTS manga_base_url TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS manga_slug TEXT;

-- Cross-media manga MAL id for the MangaCollector crossings.
--
-- The MangaCollector library keys each series on the MANGA's MAL id, but a
-- figurine's series is usually linked to the ANIME (a different MAL id). This
-- column holds the series' manga-side MAL id — for a manga series, its own; for
-- an anime, the related/source manga's, resolved from AniList relations — so the
-- crossings join can line FC figures up with the manga shelf even when the
-- figure is tagged with the anime. Backfilled by `services::manga_sync`; the
-- sentinel `0` means "resolved, no manga side" (so it isn't reprocessed and
-- never matches a real, positive MAL id).
--
-- Idempotent — safe to re-run.

ALTER TABLE series ADD COLUMN IF NOT EXISTS manga_mal_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_series_manga_mal_id
    ON series(manga_mal_id) WHERE manga_mal_id IS NOT NULL;

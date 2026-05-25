-- Performance indexes — fills the gaps the Sprint-2 perf audit identified.
--
-- All five are CONCURRENTLY-friendly (CREATE INDEX IF NOT EXISTS) so they're
-- safe to re-apply. We don't use CREATE INDEX CONCURRENTLY in this migration
-- runner because sqlx wraps each file in a transaction; CONCURRENTLY can't
-- run inside one. For the dev DB, this is fine — production rollouts that
-- need zero-downtime can drop these into a separate manual session with
-- CONCURRENTLY prepended.

-- /api/u/{slug}, /api/compare/{slug}, owned-item listing all hit
-- figure_series via figure_id; without this every list scan is a Seq Scan
-- on figure_series + filter.
CREATE INDEX IF NOT EXISTS figure_series_figure_id_idx
    ON figure_series (figure_id);

-- Same shape for figure_characters — joined whenever a figure's character
-- list is rendered (catalog tile, detail page, public profile).
CREATE INDEX IF NOT EXISTS figure_characters_figure_id_idx
    ON figure_characters (figure_id);

-- /api/compare/{slug} (intersect / yours-only / theirs-only buckets) and
-- per-user figure-existence checks in routes/owned.rs all filter
-- owned_items by (figure_id, user_id). The existing single-column
-- owned_items(figure_id) index covers half the predicate; the composite
-- avoids a heap fetch when the user filter is tight.
CREATE INDEX IF NOT EXISTS owned_items_figure_user_idx
    ON owned_items (figure_id, user_id);

-- services/release_cron.rs runs SELECT … WHERE release_date_current = $1
-- AND status NOT IN (...) daily. Without this index PG sequentially
-- scans the entire preorders table every cron tick — fine at <10k rows,
-- pathological once a user collection grows. The partial WHERE filters
-- out terminal statuses so the index stays small.
CREATE INDEX IF NOT EXISTS preorders_release_status_idx
    ON preorders (release_date_current)
    WHERE status NOT IN ('received', 'cancelled');

-- A future GC sweep ("delete dedup rows older than 90 days") will need
-- an index on sent_at to avoid a Seq Scan. notification_dedup grows
-- unbounded today; this index sets the floor for cheap cleanup.
CREATE INDEX IF NOT EXISTS notification_dedup_sent_at_idx
    ON notification_dedup (sent_at);

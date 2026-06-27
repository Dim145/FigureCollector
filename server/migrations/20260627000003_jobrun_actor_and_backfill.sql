-- WHO triggered a server job run + a retroactive `changed` backfill.
--
-- 1. `triggered_by_user` records the admin who launched a MANUAL run (NULL for
--    scheduled ticks). ON DELETE SET NULL so removing a user keeps the history.
-- 2. Backfill `changed` for legacy SUCCESSFUL rows that predate the column, so
--    the console's "hide no-op" filter works retroactively. One UPDATE per job,
--    only WHERE changed IS NULL AND state='ready' — derived from the same result
--    keys as services/job_runner.rs::changed_from. NULL stays NULL for unknown
--    jobs / non-ready rows, so those are never hidden.
-- Idempotent (ADD COLUMN IF NOT EXISTS; the backfill is guarded by changed IS NULL).

ALTER TABLE server_job_runs
    ADD COLUMN IF NOT EXISTS triggered_by_user UUID REFERENCES users(id) ON DELETE SET NULL;

UPDATE server_job_runs
   SET changed = COALESCE((result->>'purged')::bigint, 0)
 WHERE changed IS NULL AND state = 'ready' AND job_name = 'scan_cleanup';

UPDATE server_job_runs
   SET changed = COALESCE((result->>'filled')::bigint, 0)
 WHERE changed IS NULL AND state = 'ready' AND job_name = 'manga_sync';

UPDATE server_job_runs
   SET changed = COALESCE((result->>'updated')::bigint, 0)
 WHERE changed IS NULL AND state = 'ready' AND job_name = 'price_cron';

UPDATE server_job_runs
   SET changed = COALESCE((result->>'release_today')::bigint, 0)
               + COALESCE((result->>'release_j7')::bigint, 0)
               + COALESCE((result->>'delivery_today')::bigint, 0)
               + COALESCE((result->>'delivery_overdue')::bigint, 0)
 WHERE changed IS NULL AND state = 'ready' AND job_name = 'release_cron';

UPDATE server_job_runs
   SET changed = COALESCE((result->>'indexed')::bigint, 0)
               + COALESCE((result->>'queued')::bigint, 0)
 WHERE changed IS NULL AND state = 'ready' AND job_name LIKE 'reindex%';

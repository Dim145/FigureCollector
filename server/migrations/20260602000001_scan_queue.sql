-- Queue management for gsplat scans (Lot 9).
--
-- The `scans` table is already a Postgres job queue (FOR UPDATE SKIP LOCKED).
-- This adds the bookkeeping the admin "Tasks" view + worker crash-recovery need:
--   · worker_id   — which worker claimed the job (was only knowable via hostname)
--   · claimed_at  — when work actually started (→ real execution time)
--   · finished_at — when it reached a terminal state (ready/failed)
--   · attempts    — how many times it's been claimed (retries / recoveries)
--
-- Idempotent.
ALTER TABLE scans ADD COLUMN IF NOT EXISTS worker_id   UUID REFERENCES workers(id) ON DELETE SET NULL;
ALTER TABLE scans ADD COLUMN IF NOT EXISTS claimed_at  TIMESTAMPTZ;
ALTER TABLE scans ADD COLUMN IF NOT EXISTS finished_at TIMESTAMPTZ;
ALTER TABLE scans ADD COLUMN IF NOT EXISTS attempts    INTEGER NOT NULL DEFAULT 0;

-- A worker recovers its own abandoned jobs at boot (worker_id = me, state =
-- 'processing'); index that lookup. Partial — only in-flight rows matter.
CREATE INDEX IF NOT EXISTS scans_worker_idx
    ON scans (worker_id) WHERE worker_id IS NOT NULL;

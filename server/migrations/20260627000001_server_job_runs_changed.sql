-- A generic "items changed / affected" counter on every server job run, so the
-- admin task console can hide NO-OP runs (changed = 0) generically — without
-- per-job knowledge of which result keys mean "work happened". Jobs set it
-- either explicitly (a `changed` key in their result JSON, the convention for
-- new jobs) or it is derived from each built-in job's known result keys
-- (see services/job_runner.rs::changed_from).
--
-- NULL = legacy / unknown run → treated as "did something" and NEVER hidden by
-- the no-op filter, so old rows and untracked jobs stay visible.
ALTER TABLE server_job_runs
    ADD COLUMN IF NOT EXISTS changed BIGINT;

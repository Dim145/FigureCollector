-- History of the server's OWN background jobs (release cron, scan cleanup,
-- manga sync, price cron) — runs executed in-process by the server, not by a
-- gsplat worker. Surfaced on the admin Tasks page alongside the worker queue;
-- the SPA shows "Serveur" where the worker name would be.
--
-- `state` deliberately reuses the scans vocabulary (processing / ready /
-- failed) so the admin UI renders both with the same chips and filters.
-- `triggered_by` records whether the schedule fired it or an admin relaunched
-- it. Old runs are pruned per job when a new run starts (keep ~30).
CREATE TABLE IF NOT EXISTS server_job_runs (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    job_name      TEXT        NOT NULL,
    triggered_by  TEXT        NOT NULL DEFAULT 'schedule',
    state         TEXT        NOT NULL DEFAULT 'processing',
    result        JSONB,
    error_message TEXT,
    started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS server_job_runs_job_idx
    ON server_job_runs (job_name, started_at DESC);

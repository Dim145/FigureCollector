-- Liveness register for long-lived background SERVICES (crons, listeners,
-- pollers, fan-out workers). Unlike `server_job_runs`, which keeps a per-run
-- HISTORY, a service has no discrete "runs" — it just needs to prove it is
-- alive and report its last error. One row per service, upserted on each beat.
-- The admin Tasks console reads this to show every service's liveness.
-- Idempotent.
CREATE TABLE IF NOT EXISTS service_heartbeats (
    service_name TEXT PRIMARY KEY,
    kind         TEXT NOT NULL,
    status       TEXT NOT NULL,
    detail       JSONB,
    last_beat_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_error   TEXT,
    last_error_at TIMESTAMPTZ
);

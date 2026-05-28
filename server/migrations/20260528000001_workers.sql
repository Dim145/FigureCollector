-- Migration 28 — workers registry
--
-- Tracks every gsplat worker that's ever connected (CUDA / Metal) so the
-- admin can see who's online, who's enabled, and so the scan-creation route
-- can short-circuit a gsplat upload when no live worker exists.
--
-- Schema decisions:
-- - PK is a UUID, generated client-side by the worker only on first run
--   (the worker re-uses the row identified by (hostname, kind) on restart).
-- - Hardware fields stay loosely typed (TEXT) — the values come from
--   platform-specific probes (system_profiler, nvidia-smi, …) and we want
--   to display them as-is, not parse them server-side.
-- - `display_name` defaults to NULL; the admin UI falls back to `hostname`
--   when it's not set. Lets the admin rename without losing the identity
--   anchor `(hostname, kind)`.
-- - `heartbeat_interval_secs` is reported by the worker (its env var); the
--   backend computes "offline" as `last_seen < now() - interval * 3`. That
--   constant (3) lives in code, not here.
-- - `enabled` is the admin's enable/disable switch — the worker reads it
--   on every poll and skips claiming if false. NOT an "is online" flag.

CREATE TABLE IF NOT EXISTS workers (
    id                        UUID PRIMARY KEY,
    hostname                  TEXT NOT NULL,
    display_name              TEXT,
    kind                      TEXT NOT NULL CHECK (kind IN ('cuda', 'metal')),
    -- hardware
    os                        TEXT NOT NULL,
    arch                      TEXT NOT NULL,
    gpu                       TEXT,
    gpu_memory_mb             INTEGER,
    runtime_version           TEXT,
    worker_version            TEXT,
    -- liveness
    heartbeat_interval_secs   INTEGER NOT NULL DEFAULT 30,
    last_seen                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- admin
    enabled                   BOOLEAN NOT NULL DEFAULT TRUE,
    registered_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (hostname, kind)
);

CREATE INDEX IF NOT EXISTS idx_workers_last_seen ON workers (last_seen);
CREATE INDEX IF NOT EXISTS idx_workers_enabled ON workers (enabled);

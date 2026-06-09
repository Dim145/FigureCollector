-- App-wide settings: a small key/value table for admin-tunable policies.
-- First use: who may create 3D / Gaussian-splat scans (everyone vs admins-only).
-- Idempotent so it's a safe no-op on a DB already migrated by the old system.
CREATE TABLE IF NOT EXISTS app_settings (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

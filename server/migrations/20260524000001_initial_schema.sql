-- =============================================================================
-- FigureCollector — Phase 1 initial schema
--
-- Tables:
--   users               : the canonical identity per account
--   oauth_identities    : zero-or-more external IdP links per user (Google, OIDC, …)
--   local_credentials   : optional Argon2id password hash (when local auth is used)
--
-- The session storage table is managed by tower-sessions-sqlx-store separately
-- (see `PostgresStore::migrate()` at server startup).
--
-- Idempotent — re-running this script on an already-migrated database is a
-- no-op (every DDL uses IF NOT EXISTS or CREATE OR REPLACE).
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---- users ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    username      TEXT        NOT NULL UNIQUE,
    email         TEXT,
    display_name  TEXT        NOT NULL,
    avatar_url    TEXT,
    locale        TEXT        NOT NULL DEFAULT 'fr',
    is_admin      BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_login_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_idx
    ON users (LOWER(email))
    WHERE email IS NOT NULL;

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---- oauth_identities -------------------------------------------------------
CREATE TABLE IF NOT EXISTS oauth_identities (
    provider    TEXT        NOT NULL,
    subject     TEXT        NOT NULL,
    user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    email       TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (provider, subject)
);

CREATE INDEX IF NOT EXISTS oauth_identities_user_id_idx ON oauth_identities (user_id);

-- ---- local_credentials ------------------------------------------------------
CREATE TABLE IF NOT EXISTS local_credentials (
    user_id        UUID        PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    password_hash  TEXT        NOT NULL,
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE TRIGGER local_credentials_updated_at
    BEFORE UPDATE ON local_credentials
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

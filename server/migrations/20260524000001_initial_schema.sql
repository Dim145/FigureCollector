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
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---- users ------------------------------------------------------------------
CREATE TABLE users (
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

-- Case-insensitive uniqueness for email (NULL emails are allowed and not unique).
CREATE UNIQUE INDEX users_email_lower_idx
    ON users (LOWER(email))
    WHERE email IS NOT NULL;

-- Auto-bump updated_at on row UPDATE.
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---- oauth_identities -------------------------------------------------------
-- A given external (provider, subject) maps to exactly one user, but a user
-- can have multiple identities (e.g. Google + a generic OIDC IdP).
CREATE TABLE oauth_identities (
    provider    TEXT        NOT NULL,
    subject     TEXT        NOT NULL,
    user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    email       TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (provider, subject)
);

CREATE INDEX oauth_identities_user_id_idx ON oauth_identities (user_id);

-- ---- local_credentials ------------------------------------------------------
-- Optional. Present only for users who registered with username/password.
CREATE TABLE local_credentials (
    user_id        UUID        PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    password_hash  TEXT        NOT NULL,    -- Argon2id PHC string
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER local_credentials_updated_at
    BEFORE UPDATE ON local_credentials
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

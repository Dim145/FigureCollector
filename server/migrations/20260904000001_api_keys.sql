-- Per-user API keys — the credential for the MCP endpoint (`/mcp`).
--
-- The wire format is `fck_<prefix>_<secret>`:
--   * `prefix` (16 hex chars, 64 bits) is a *public* handle. It carries a
--     unique index so resolving a presented key is a single indexed lookup
--     instead of a full-table scan, and it is safe to show in the UI so a
--     user can tell their keys apart.
--   * `secret` (64 hex chars, 256 bits) is never stored. We keep its
--     SHA-256 and compare in constant time. A salted KDF (Argon2id, as used
--     for passwords) would be wrong here: the secret is high-entropy random,
--     not a guessable password, so there is nothing to slow down — and a
--     per-row salt would forbid the index that makes lookup cheap.
--
-- `scopes` is an explicit allow-list; an empty array grants nothing. Keys are
-- revoked by stamping `revoked_at` (never deleted, so the audit log keeps a
-- resolvable foreign key).
CREATE TABLE IF NOT EXISTS api_keys (
    id           UUID PRIMARY KEY,
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    prefix       TEXT NOT NULL,
    secret_hash  TEXT NOT NULL,
    scopes       TEXT[] NOT NULL DEFAULT '{}',
    expires_at   TIMESTAMPTZ,
    last_used_at TIMESTAMPTZ,
    revoked_at   TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS api_keys_prefix_key ON api_keys (prefix);

-- Drives the "my keys" list; live keys only, newest first.
CREATE INDEX IF NOT EXISTS api_keys_user_idx
    ON api_keys (user_id, created_at DESC)
    WHERE revoked_at IS NULL;

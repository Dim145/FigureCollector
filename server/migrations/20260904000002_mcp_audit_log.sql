-- Audit trail for MCP tool calls.
--
-- One row per `tools/call` (and per resource read / prompt fetch), so a user
-- can see what an agent did on their behalf and an operator can investigate
-- abuse. Arguments are recorded as a SHA-256 digest, never verbatim: they
-- carry prices, private notes and shop names, and this table is read back by
-- the owning user's own UI.
CREATE TABLE IF NOT EXISTS mcp_audit_log (
    id           UUID PRIMARY KEY,
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    api_key_id   UUID REFERENCES api_keys(id) ON DELETE SET NULL,
    at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    tool         TEXT NOT NULL,
    -- 'ok' | 'denied' (scope refused / confirm missing) | 'error'
    outcome      TEXT NOT NULL,
    duration_ms  INTEGER,
    args_digest  TEXT,
    target_id    UUID,
    detail       TEXT
);

CREATE INDEX IF NOT EXISTS mcp_audit_log_user_idx ON mcp_audit_log (user_id, at DESC);

-- MangaCollector server registry (Lot 8b · security).
--
-- Replaces the free-form `users.manga_base_url` with an ADMIN-CURATED allow-list
-- of MangaCollector origins. A user links by choosing an `approved` server, or by
-- submitting a new one — which lands as `pending` and stays inert until an admin
-- approves it. Revoking a server flips it to `revoked`, which disables every link
-- that points at it. Every outbound fetch still runs through the SSRF guard +
-- no-redirect client; the registry is a second gate, not a replacement.
--
-- Idempotent — safe to re-run on a DB that already carries these objects.

CREATE TABLE IF NOT EXISTS manga_servers (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Normalized origin (scheme://host[:port][/base-path]), the allow-list key.
    base_url     TEXT        NOT NULL UNIQUE,
    -- Optional friendly label an admin can set ("Instance officielle").
    label        TEXT,
    status       TEXT        NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending', 'approved', 'revoked')),
    submitted_by UUID        REFERENCES users(id) ON DELETE SET NULL,
    reviewed_by  UUID        REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at  TIMESTAMPTZ,
    -- Admin note; doubles as the revocation reason surfaced to linked users.
    note         TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_manga_servers_status ON manga_servers(status);

-- Reuse the global updated_at trigger function from the initial schema.
DROP TRIGGER IF EXISTS manga_servers_touch ON manga_servers;
CREATE TRIGGER manga_servers_touch
    BEFORE UPDATE ON manga_servers
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- New FK on users. `manga_slug` stays as-is; the old free-form `manga_base_url`
-- is migrated into the registry below, then dropped.
ALTER TABLE users ADD COLUMN IF NOT EXISTS manga_server_id UUID
    REFERENCES manga_servers(id) ON DELETE SET NULL;

-- One-shot data migration, guarded so re-runs (after the column is gone) no-op.
-- Existing links migrate in as `pending` per the user's chosen policy — the
-- integration pauses until an admin approves them from the admin page.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'users' AND column_name = 'manga_base_url'
    ) THEN
        -- One pending server per distinct normalized base_url currently in use.
        INSERT INTO manga_servers (base_url, status, submitted_by, note)
        SELECT DISTINCT ON (lower(rtrim(btrim(manga_base_url), '/')))
               lower(rtrim(btrim(manga_base_url), '/')),
               'pending',
               id,
               'Migré depuis un lien existant — à valider'
        FROM users
        WHERE manga_base_url IS NOT NULL AND btrim(manga_base_url) <> ''
        ORDER BY lower(rtrim(btrim(manga_base_url), '/')), id
        ON CONFLICT (base_url) DO NOTHING;

        -- Point each previously-linked user at their (now pending) server row.
        UPDATE users u
        SET manga_server_id = ms.id
        FROM manga_servers ms
        WHERE u.manga_base_url IS NOT NULL
          AND btrim(u.manga_base_url) <> ''
          AND ms.base_url = lower(rtrim(btrim(u.manga_base_url), '/'));

        ALTER TABLE users DROP COLUMN manga_base_url;
    END IF;
END $$;

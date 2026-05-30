-- Proof-of-purchase / receipt attachments on an owned item. Unlike photos
-- (re-encoded to WebP, world-readable for catalogue shots), these are stored
-- byte-for-byte (a PDF stays a PDF) and are strictly PRIVATE to the owner — the
-- serving proxy gates on the session user, never public.
CREATE TABLE IF NOT EXISTS owned_item_documents (
    id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    owned_item_id  UUID        NOT NULL REFERENCES owned_items(id) ON DELETE CASCADE,
    user_id        UUID        NOT NULL REFERENCES users(id)       ON DELETE CASCADE,
    storage_key    TEXT        NOT NULL,
    filename       TEXT        NOT NULL,
    mime           TEXT        NOT NULL,
    size_bytes     BIGINT      NOT NULL DEFAULT 0,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS owned_item_documents_item_idx
    ON owned_item_documents (owned_item_id, created_at DESC);

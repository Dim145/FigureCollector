-- Migration 22 — promote "store" from free-text to a first-class entity
--
-- Currently `owned_items.store` and `preorders.store` are free-text columns.
-- Users typing "AmiAmi", "amiami", "Ami Ami" produce three uncomparable
-- values. Moving stores into their own table lets:
--   - admins curate canonical store metadata (URL, profile image, description)
--   - the SPA offer autocomplete on the input
--   - a /stores/<slug> page show the catalogue of figures bought there
--
-- Data migration strategy:
--   1. Create the `stores` table.
--   2. For every distinct non-null store name across owned_items+preorders,
--      INSERT a stores row with a generated slug. ON CONFLICT (slug) DO
--      NOTHING — two text values that slugify identically merge into one
--      canonical row (e.g. "AmiAmi" + "amiami" → single store).
--   3. Add nullable `store_id` FK columns to both tables, then populate
--      them by joining on the slugified text.
--   4. Drop the old free-text `store` columns. The display layer reads
--      `stores.name` through the join.
--
-- ON DELETE SET NULL on the FK so an admin can delete a store without
-- destroying user data — the linked records simply unset their reference.

-- ── 1. The stores table ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS stores (
    id                  UUID PRIMARY KEY,
    name                TEXT NOT NULL,
    slug                TEXT NOT NULL UNIQUE,
    url                 TEXT,
    image_storage_key   TEXT,
    description         TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Updated-at trigger, same pattern as other tables.
CREATE OR REPLACE FUNCTION stores_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS stores_touch ON stores;
CREATE TRIGGER stores_touch
    BEFORE UPDATE ON stores
    FOR EACH ROW
    EXECUTE FUNCTION stores_touch_updated_at();

-- ── 2. Slugify helper, used both by this migration and by future inserts ────
--
-- Slug rules (mirror the Rust slugify used elsewhere):
--   - lowercase
--   - keep [a-z0-9]
--   - collapse runs of non-alphanumerics into a single "-"
--   - trim leading/trailing "-"
--   - fall back to "store" if the input had nothing useful
CREATE OR REPLACE FUNCTION slugify_store(input TEXT) RETURNS TEXT AS $$
DECLARE
    s TEXT;
BEGIN
    s := lower(coalesce(input, ''));
    -- Strip diacritics where possible (using unaccent would need an
    -- extension; we approximate by removing common ones via regexp).
    s := translate(s,
        'àáâãäåçèéêëìíîïñòóôõöùúûüýÿæœÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝŸÆŒ',
        'aaaaaaceeeeiiiinooooouuuuyyaoaaaaaaceeeeiiiinooooouuuuyyAOE');
    -- Replace any non-alphanumeric run with a single dash.
    s := regexp_replace(s, '[^a-z0-9]+', '-', 'g');
    -- Trim leading/trailing dashes.
    s := regexp_replace(s, '^-+|-+$', '', 'g');
    IF length(s) = 0 THEN
        s := 'store';
    END IF;
    RETURN s;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ── 3. Seed `stores` from existing values ──────────────────────────────────
--
-- We pull DISTINCT trimmed-non-empty values out of both source tables,
-- generate UUIDs and slugs in-line. ON CONFLICT(slug) DO NOTHING means
-- "AmiAmi" and "amiami" collapse into one canonical row whose name is
-- whichever came first.
INSERT INTO stores (id, name, slug)
SELECT
    gen_random_uuid(),
    trim(s.store),
    slugify_store(s.store)
FROM (
    SELECT DISTINCT trim(store) AS store FROM owned_items
        WHERE store IS NOT NULL AND trim(store) <> ''
    UNION
    SELECT DISTINCT trim(store) AS store FROM preorders
        WHERE store IS NOT NULL AND trim(store) <> ''
) s
ON CONFLICT (slug) DO NOTHING;

-- ── 4. FK columns + backfill ────────────────────────────────────────────────
ALTER TABLE owned_items
    ADD COLUMN IF NOT EXISTS store_id UUID
        REFERENCES stores(id) ON DELETE SET NULL;
ALTER TABLE preorders
    ADD COLUMN IF NOT EXISTS store_id UUID
        REFERENCES stores(id) ON DELETE SET NULL;

UPDATE owned_items o
   SET store_id = s.id
  FROM stores s
 WHERE o.store IS NOT NULL
   AND o.store_id IS NULL
   AND s.slug = slugify_store(o.store);

UPDATE preorders p
   SET store_id = s.id
  FROM stores s
 WHERE p.store IS NOT NULL
   AND p.store_id IS NULL
   AND s.slug = slugify_store(p.store);

-- ── 5. Drop the legacy free-text columns ────────────────────────────────────
ALTER TABLE owned_items DROP COLUMN IF EXISTS store;
ALTER TABLE preorders   DROP COLUMN IF EXISTS store;

-- ── 6. Lookup indexes ──────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS owned_items_store_idx ON owned_items (store_id);
CREATE INDEX IF NOT EXISTS preorders_store_idx   ON preorders (store_id);

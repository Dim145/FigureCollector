-- =============================================================================
-- figure_stores — many-to-many between figures and stores.
--
-- Source of truth:
--   1. Implicit: any owned_item / preorder linking a (figure, store) auto-
--      creates the corresponding row via the triggers below. Once created,
--      the row stays even if the underlying owned_item / preorder is
--      deleted — historical association is intentional ("this figure was
--      sold here").
--   2. Explicit: admins can manually add or remove links from either side
--      (figure form, store page, bulk endpoint).
--
-- Admin DELETE just removes the row. The trigger will re-create it next
-- time an owned_item / preorder writes the same (figure, store) pair, so
-- the M2M state can never drift below what's implied by user data — only
-- above it (manual admin additions).
-- =============================================================================

CREATE TABLE IF NOT EXISTS figure_stores (
    figure_id  UUID NOT NULL REFERENCES figures(id) ON DELETE CASCADE,
    store_id   UUID NOT NULL REFERENCES stores(id)  ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (figure_id, store_id)
);

-- Index for "stores for a figure" queries (the catalog button needs this).
-- The PK already covers (figure_id, store_id), but we also lookup by store_id
-- alone for the store-catalog view.
CREATE INDEX IF NOT EXISTS figure_stores_store_idx ON figure_stores(store_id);

-- ----------------------------------------------------------------------------
-- Backfill from existing user data — every owned / preorder with a store_id
-- becomes a link.
-- ----------------------------------------------------------------------------

INSERT INTO figure_stores (figure_id, store_id)
    SELECT DISTINCT figure_id, store_id FROM owned_items WHERE store_id IS NOT NULL
    UNION
    SELECT DISTINCT figure_id, store_id FROM preorders   WHERE store_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- ----------------------------------------------------------------------------
-- Auto-link triggers.
--
-- Whenever an owned_item or preorder is inserted, or its store_id is
-- updated, ensure (figure_id, store_id) exists in figure_stores. We DON'T
-- remove anything — admin-only deletes from the M2M, and historical state
-- is preserved.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION sync_figure_store_from_owned()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.store_id IS NOT NULL THEN
        INSERT INTO figure_stores (figure_id, store_id)
        VALUES (NEW.figure_id, NEW.store_id)
        ON CONFLICT DO NOTHING;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS owned_items_sync_store ON owned_items;
CREATE TRIGGER owned_items_sync_store
    AFTER INSERT OR UPDATE OF store_id ON owned_items
    FOR EACH ROW EXECUTE FUNCTION sync_figure_store_from_owned();

CREATE OR REPLACE FUNCTION sync_figure_store_from_preorder()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.store_id IS NOT NULL THEN
        INSERT INTO figure_stores (figure_id, store_id)
        VALUES (NEW.figure_id, NEW.store_id)
        ON CONFLICT DO NOTHING;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS preorders_sync_store ON preorders;
CREATE TRIGGER preorders_sync_store
    AFTER INSERT OR UPDATE OF store_id ON preorders
    FOR EACH ROW EXECUTE FUNCTION sync_figure_store_from_preorder();

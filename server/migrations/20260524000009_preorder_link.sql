-- =============================================================================
-- 9) Link preorders to owned_items so the lifecycle stays consistent
--
-- A preorder is now optionally tied to the owned_item that the user added.
-- When the user adds an owned_item for a figure whose release_date is in the
-- future, the server inserts a `preorders` row automatically with this FK
-- pointing back. Deleting the owned_item also drops the preorder (cascade)
-- because keeping a dangling preorder for a piece the user removed makes no
-- sense.
-- =============================================================================

ALTER TABLE preorders
    ADD COLUMN IF NOT EXISTS owned_item_id UUID
        REFERENCES owned_items(id) ON DELETE CASCADE;

-- One auto-preorder per owned_item — if the user manually creates another
-- preorder for the same figurine later (e.g. a re-release), it stays unlinked.
CREATE UNIQUE INDEX IF NOT EXISTS preorders_owned_item_idx
    ON preorders (owned_item_id)
    WHERE owned_item_id IS NOT NULL;

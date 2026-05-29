-- Per-item manual sort order, used by the Vitrines drag-and-drop organiser to
-- order pieces WITHIN a cabinet (and on cross-cabinet drops). Null = unsorted
-- (sinks to the end, ordered by created_at). Scoped per item; other views keep
-- their own ordering.
ALTER TABLE owned_items ADD COLUMN IF NOT EXISTS sort_order INTEGER;

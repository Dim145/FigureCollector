-- One-time cleanup for the "owned ≠ wishlist" rule.
--
-- A figure that already sits in a user's collection (a non-archived
-- owned_item) can no longer also be in that user's wishlist. Drop every
-- overlapping wishlist row. Idempotent: re-running finds nothing left to
-- delete, and the handler-level enforcement (owned::create clears the wish,
-- wishlist::add refuses an owned figure) keeps it that way going forward.
DELETE FROM wishlist_items w
USING owned_items o
WHERE o.user_id = w.user_id
  AND o.figure_id = w.figure_id
  AND o.archived_at IS NULL;

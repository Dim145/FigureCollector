-- Migration 19 — preorder cancellation refund + owned archive
--
-- Two coupled concepts:
--
-- 1) preorders.deposit_refund_amount  (NUMERIC, NULL)
--    Tracks what was actually paid back when a preorder is cancelled.
--    Semantics:
--      NULL                              → no refund decision yet (pending /
--                                          unknown). UI prompts the user.
--      0                                 → deposit was lost in full.
--      0 < refund < deposit_amount       → partial refund. The delta is the
--                                          user's net loss.
--      refund == deposit_amount          → fully refunded; no loss.
--      refund > deposit_amount           → extra compensation (rare). Treated
--                                          as "fully refunded" for loss
--                                          calculations.
--    Currency is implicit — same as price_currency on the preorder, like the
--    deposit itself.
--
-- 2) owned_items.archived_at  (TIMESTAMPTZ, NULL)
--    When a preorder is cancelled with a partial / no refund, the owned_item
--    can't simply be deleted — there's a real loss to remember and the
--    catalogue history matters. We archive it instead:
--      - default list views (/me/owned, /collection) filter archived_at IS NULL
--      - "Voir aussi annulées" toggle exposes them with a chip
--      - Restoring clears archived_at and lets the user reactivate the
--        preorder or replace it.

ALTER TABLE preorders
    ADD COLUMN IF NOT EXISTS deposit_refund_amount NUMERIC(12, 2);

ALTER TABLE owned_items
    ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

-- Partial index for the common "active collection" path. Most queries
-- against owned_items filter `archived_at IS NULL`; the partial index
-- keeps that scan tight without bloating with the rare archived rows.
CREATE INDEX IF NOT EXISTS owned_items_active_idx
    ON owned_items (user_id)
    WHERE archived_at IS NULL;

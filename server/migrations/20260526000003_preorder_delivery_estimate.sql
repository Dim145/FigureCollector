-- Migration 20 — preorder delivery estimate
--
-- When a preorder ships, the carrier hands out an ETA ("delivered within
-- 5-10 business days"). We let the user record that estimate as a simple
-- integer day count (`estimated_delivery_days`), combined with a
-- `shipped_at` timestamp auto-set on the status='shipped' transition.
--
-- The actual delivery_date is computed on the fly:
--   delivery_date = shipped_at::date + estimated_delivery_days * INTERVAL '1 day'
--
-- The pair drives the SPA countdown chip ("J-3" / "J+2") and the daily
-- cron job that fires:
--   * preorder_delivery_today    when delivery_date == today
--   * preorder_delivery_overdue  when delivery_date == today - 1 (J+1)
-- Both with dedup keys so the worker can run safely on every boot.

ALTER TABLE preorders
    ADD COLUMN IF NOT EXISTS shipped_at TIMESTAMPTZ;
ALTER TABLE preorders
    ADD COLUMN IF NOT EXISTS estimated_delivery_days INTEGER;

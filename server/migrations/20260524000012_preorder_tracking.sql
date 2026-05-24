-- Migration 012 — preorder tracking URL
--
-- Add an optional tracking URL to preorders. The carrier + tracking number
-- are derived client-side from the URL itself (UPS / DHL / Colissimo /
-- Chronopost / FedEx / USPS / Mondial Relay / GLS / TNT / Japan Post …),
-- so no extra columns are needed — the URL is the single source of truth.

ALTER TABLE preorders
    ADD COLUMN IF NOT EXISTS tracking_url TEXT;

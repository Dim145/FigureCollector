-- Provenance & archive reason for owned_items.
--
-- Three free-form-but-enumerated facets a collector wants on a piece:
--   acquisition_source — how it entered the collection (purchased/gift/trade/
--                        found/inherited/other). NULL = unrecorded.
--   acquired_from      — free text "from whom / where" (a friend's name, an
--                        event, a marketplace seller). NULL = unrecorded.
--   archive_reason     — why a piece was archived (sold/traded/lost/gifted/
--                        other). Captured when archived_at is set; NULL on
--                        active pieces. Distinct enum from acquisition_source
--                        (an exit reason, not an entry one).
--
-- All three are nullable plain TEXT — the server validates the enum members
-- (mirrors the condition allow-list); no CHECK constraint so the set can grow
-- without a migration. Idempotent ADD COLUMN IF NOT EXISTS keeps this a no-op
-- on a DB the old sqlx::migrate! system already touched.
ALTER TABLE owned_items
    ADD COLUMN IF NOT EXISTS acquisition_source TEXT,
    ADD COLUMN IF NOT EXISTS acquired_from      TEXT,
    ADD COLUMN IF NOT EXISTS archive_reason     TEXT;

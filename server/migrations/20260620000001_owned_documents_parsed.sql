-- Parsed-invoice metadata for proof-of-purchase documents.
--
-- Populated on demand when the user clicks "Extraire les infos" on a
-- justificatif (Palier 1: pure-Rust pdf-extract + heuristics, no OCR/cloud).
-- Stored as JSONB on the document row — NOT on owned_items — so the figure's
-- own purchase fields stay user-controlled: parsing only ever *suggests*.
-- Idempotent (safe no-op on an already-migrated DB).
ALTER TABLE owned_item_documents
    ADD COLUMN IF NOT EXISTS parsed_metadata JSONB,
    ADD COLUMN IF NOT EXISTS parsed_at       TIMESTAMPTZ;

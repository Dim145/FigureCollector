-- Migration 011 — entity metadata
--
-- Round out manufacturers / series / characters with the metadata the SPA
-- needs to drive dedicated entity pages: description, optional Garage-uploaded
-- image (`image_key`) alongside the existing external URL (`logo_url` /
-- `cover_url` / `portrait_url`), and external identity columns
-- (`anilist_id` / `mal_id`) on characters (series already had them).
--
-- Idempotent throughout: every ALTER uses IF NOT EXISTS, every CREATE INDEX
-- uses IF NOT EXISTS. Safe to re-run on databases that already executed
-- pieces of this manually.

-- ─── manufacturers ──────────────────────────────────────────────────────────
-- `logo_url` already exists from migration 002. We add description, an
-- optional company website, and a Garage object key so admins can upload a
-- logo directly into the bucket instead of hot-linking.
ALTER TABLE manufacturers
    ADD COLUMN IF NOT EXISTS description TEXT,
    ADD COLUMN IF NOT EXISTS website_url TEXT,
    ADD COLUMN IF NOT EXISTS image_key   TEXT;

-- ─── series ─────────────────────────────────────────────────────────────────
-- `anilist_id`, `mal_id`, `description`, `cover_url`, `origin` already exist.
-- We add `external_url` for the official site (often distinct from AniList /
-- MAL pages) and a Garage object key.
ALTER TABLE series
    ADD COLUMN IF NOT EXISTS external_url TEXT,
    ADD COLUMN IF NOT EXISTS image_key    TEXT;

-- ─── characters ─────────────────────────────────────────────────────────────
-- Characters were the most barebones — only had name / slug / series_id /
-- portrait_url. Promote them to first-class entities matching series.
ALTER TABLE characters
    ADD COLUMN IF NOT EXISTS description  TEXT,
    ADD COLUMN IF NOT EXISTS external_url TEXT,
    ADD COLUMN IF NOT EXISTS anilist_id   INTEGER,
    ADD COLUMN IF NOT EXISTS mal_id       INTEGER,
    ADD COLUMN IF NOT EXISTS image_key    TEXT;

-- ─── uniqueness on external ids ─────────────────────────────────────────────
-- Partial unique indexes so the AniList / MAL upserts can't accidentally
-- create two rows for the same upstream entity (different slug, same id).
CREATE UNIQUE INDEX IF NOT EXISTS series_anilist_id_uq
    ON series (anilist_id) WHERE anilist_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS series_mal_id_uq
    ON series (mal_id) WHERE mal_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS characters_anilist_id_uq
    ON characters (anilist_id) WHERE anilist_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS characters_mal_id_uq
    ON characters (mal_id) WHERE mal_id IS NOT NULL;

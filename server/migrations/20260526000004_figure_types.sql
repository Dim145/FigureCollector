-- Migration 21 — figure_types table
--
-- Until now the list of valid figure_type values was a hardcoded Rust
-- const (ALLOWED_TYPES = ["scale","nendoroid","figma",…]). Moving it
-- into a table lets the admin add new types (e.g. trading_card, bust,
-- chibi) without a code change.
--
-- Schema decisions:
-- - PK is the slug (TEXT) — backward-compatible: existing
--   `figures.figure_type` rows already hold the slug verbatim. No data
--   migration on the figures table.
-- - label_fr / label_en are mandatory so the SPA dropdown always has a
--   localised string. The current i18n keys (`type.scale`, `type.nendoroid`…)
--   stay as fallbacks; the DB labels take precedence.
-- - kanji is the single-glyph mark used in the polar chart legend
--   (像 for scale, 童 for nendoroid, etc.).
-- - position drives the order in the dropdown (lowest first).
-- - Seed with the existing 10 hardcoded types so the system is
--   immediately functional after the migration runs.

CREATE TABLE IF NOT EXISTS figure_types (
    id           TEXT PRIMARY KEY,                      -- slug, e.g. "nendoroid"
    label_fr     TEXT NOT NULL,
    label_en     TEXT NOT NULL,
    kanji        TEXT NOT NULL,                         -- single-glyph mark
    position     INTEGER NOT NULL DEFAULT 100,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Trigger to bump updated_at on every UPDATE.
CREATE OR REPLACE FUNCTION figure_types_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS figure_types_touch ON figure_types;
CREATE TRIGGER figure_types_touch
    BEFORE UPDATE ON figure_types
    FOR EACH ROW
    EXECUTE FUNCTION figure_types_touch_updated_at();

-- Seed the 10 historical types. ON CONFLICT DO NOTHING so re-running on
-- an already-seeded DB is a no-op.
INSERT INTO figure_types (id, label_fr, label_en, kanji, position) VALUES
    ('nendoroid',  'Nendoroid',   'Nendoroid',   '童', 10),
    ('scale',      'Scale',       'Scale',       '像', 20),
    ('figma',      'Figma',       'Figma',       '動', 30),
    ('prize',      'Prize',       'Prize',       '賞', 40),
    ('trading',    'Trading',     'Trading',     '交', 50),
    ('statue',     'Statue',      'Statue',      '彫', 60),
    ('plamo',      'Plamo (kit)', 'Plamo (kit)', '組', 70),
    ('bishoujo',   'Bishoujo',    'Bishoujo',    '美', 80),
    ('dakimakura', 'Dakimakura',  'Dakimakura',  '枕', 90),
    ('other',      'Autre',       'Other',       '玩', 999)
ON CONFLICT (id) DO NOTHING;

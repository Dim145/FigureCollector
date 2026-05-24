-- =============================================================================
-- FigureCollector — Phase 2 figurine domain
--
-- Catalog tables (shared across all users):
--   manufacturers, sculptors, series, characters,
--   figures, figure_characters, figure_series
--
-- Per-user tables:
--   owned_items, preorders, preorder_date_history, wishlist_items
-- =============================================================================

-- ---- manufacturers ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS manufacturers (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT        NOT NULL,
    slug        TEXT        NOT NULL UNIQUE,
    country     TEXT,
    logo_url    TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS manufacturers_name_idx ON manufacturers (LOWER(name));

-- ---- sculptors --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sculptors (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT        NOT NULL,
    slug        TEXT        NOT NULL UNIQUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sculptors_name_idx ON sculptors (LOWER(name));

-- ---- series -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS series (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    name         TEXT        NOT NULL,
    slug         TEXT        NOT NULL UNIQUE,
    origin       TEXT        NOT NULL DEFAULT 'other'
                 CHECK (origin IN ('anime','manga','game','vn','light_novel','original','other')),
    anilist_id   INTEGER,
    mal_id       INTEGER,
    description  TEXT,
    cover_url    TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS series_name_idx ON series (LOWER(name));

-- ---- characters -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS characters (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT        NOT NULL,
    slug        TEXT        NOT NULL UNIQUE,
    series_id   UUID        REFERENCES series(id) ON DELETE SET NULL,
    portrait_url TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS characters_name_idx ON characters (LOWER(name));
CREATE INDEX IF NOT EXISTS characters_series_id_idx ON characters (series_id);

-- ---- figures ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS figures (
    id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    name              TEXT        NOT NULL,
    slug              TEXT        NOT NULL UNIQUE,
    manufacturer_id   UUID        REFERENCES manufacturers(id) ON DELETE SET NULL,
    sculptor_id       UUID        REFERENCES sculptors(id) ON DELETE SET NULL,
    figure_type       TEXT        NOT NULL DEFAULT 'other'
                      CHECK (figure_type IN (
                          'scale','nendoroid','figma','prize','trading','statue',
                          'plamo','bishoujo','dakimakura','other'
                      )),
    scale             TEXT,
    height_mm         INTEGER,
    materials         TEXT[]      NOT NULL DEFAULT ARRAY[]::TEXT[],
    release_date      DATE,
    msrp_amount       NUMERIC(12,2),
    msrp_currency     CHAR(3),
    jan               TEXT,
    exclusivity       TEXT,
    edition           TEXT,
    version_name      TEXT,
    official_image_url TEXT,
    description       TEXT,
    mfc_id            INTEGER,
    created_by        UUID        REFERENCES users(id) ON DELETE SET NULL,
    is_user_submitted BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS figures_name_idx        ON figures (LOWER(name));
CREATE INDEX IF NOT EXISTS figures_type_idx        ON figures (figure_type);
CREATE INDEX IF NOT EXISTS figures_manufacturer_idx ON figures (manufacturer_id);
CREATE INDEX IF NOT EXISTS figures_release_idx     ON figures (release_date);
CREATE UNIQUE INDEX IF NOT EXISTS figures_jan_uniq  ON figures (jan) WHERE jan IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS figures_mfc_uniq  ON figures (mfc_id) WHERE mfc_id IS NOT NULL;

CREATE OR REPLACE TRIGGER figures_updated_at
    BEFORE UPDATE ON figures
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---- figure_characters & figure_series (M2M) --------------------------------
CREATE TABLE IF NOT EXISTS figure_characters (
    figure_id    UUID NOT NULL REFERENCES figures(id) ON DELETE CASCADE,
    character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    PRIMARY KEY (figure_id, character_id)
);

CREATE TABLE IF NOT EXISTS figure_series (
    figure_id  UUID NOT NULL REFERENCES figures(id) ON DELETE CASCADE,
    series_id  UUID NOT NULL REFERENCES series(id)  ON DELETE CASCADE,
    PRIMARY KEY (figure_id, series_id)
);

-- ---- owned_items ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS owned_items (
    id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    figure_id      UUID        NOT NULL REFERENCES figures(id) ON DELETE RESTRICT,
    condition      TEXT        NOT NULL DEFAULT 'mib_sealed'
                   CHECK (condition IN ('mib_sealed','opened_box','displayed','loose','damaged')),
    price_amount   NUMERIC(12,2),
    price_currency CHAR(3),
    store          TEXT,
    purchase_date  DATE,
    location       TEXT,
    notes          TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS owned_items_user_id_idx   ON owned_items (user_id);
CREATE INDEX IF NOT EXISTS owned_items_figure_id_idx ON owned_items (figure_id);
CREATE INDEX IF NOT EXISTS owned_items_user_created_idx ON owned_items (user_id, created_at DESC);

CREATE OR REPLACE TRIGGER owned_items_updated_at
    BEFORE UPDATE ON owned_items
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---- wishlist_items ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS wishlist_items (
    user_id        UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    figure_id      UUID        NOT NULL REFERENCES figures(id) ON DELETE CASCADE,
    max_price_amount NUMERIC(12,2),
    max_price_currency CHAR(3),
    note           TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, figure_id)
);
CREATE INDEX IF NOT EXISTS wishlist_items_user_idx ON wishlist_items (user_id, created_at DESC);

-- ---- preorders --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS preorders (
    id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                 UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    figure_id               UUID        NOT NULL REFERENCES figures(id) ON DELETE RESTRICT,
    status                  TEXT        NOT NULL DEFAULT 'preordered'
                            CHECK (status IN (
                                'announced','preorder_open','preordered',
                                'in_production','released','shipped','received','cancelled'
                            )),
    store                   TEXT,
    order_ref               TEXT,
    release_date_original   DATE,
    release_date_current    DATE,
    price_amount            NUMERIC(12,2),
    price_currency          CHAR(3),
    notes                   TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS preorders_user_idx          ON preorders (user_id, release_date_current);
CREATE INDEX IF NOT EXISTS preorders_user_status_idx   ON preorders (user_id, status);
CREATE INDEX IF NOT EXISTS preorders_figure_idx        ON preorders (figure_id);

CREATE OR REPLACE TRIGGER preorders_updated_at
    BEFORE UPDATE ON preorders
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---- preorder_date_history --------------------------------------------------
CREATE TABLE IF NOT EXISTS preorder_date_history (
    id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    preorder_id    UUID        NOT NULL REFERENCES preorders(id) ON DELETE CASCADE,
    previous_date  DATE,
    new_date       DATE,
    source         TEXT        NOT NULL DEFAULT 'user'
                   CHECK (source IN ('user','manufacturer_announcement','store_update','scraper')),
    note           TEXT,
    noted_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS preorder_date_history_preorder_idx
    ON preorder_date_history (preorder_id, noted_at DESC);

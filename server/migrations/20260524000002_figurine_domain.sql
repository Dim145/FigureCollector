-- =============================================================================
-- FigureCollector — Phase 2 figurine domain
--
-- Catalog tables (shared across all users):
--   manufacturers, sculptors, series, characters,
--   figures, figure_characters, figure_series
--
-- Per-user tables:
--   owned_items   : a user's physical copy of a figure
--   preorders     : pre-orders with date-slip history baked in
--   preorder_date_history : audit trail of release-date revisions
--   wishlist_items: a user's "want" list
--
-- Photos / external metadata (MFC scrape cache, AniList ids) ship in Phase 2B.
-- =============================================================================

-- ---- Enum-ish constraints via CHECK -----------------------------------------
-- We keep them as TEXT (open extension) rather than PG enums (DDL-locked).

-- ---- manufacturers ----------------------------------------------------------
CREATE TABLE manufacturers (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT        NOT NULL,
    slug        TEXT        NOT NULL UNIQUE,
    country     TEXT,
    logo_url    TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX manufacturers_name_idx ON manufacturers (LOWER(name));

-- ---- sculptors --------------------------------------------------------------
CREATE TABLE sculptors (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT        NOT NULL,
    slug        TEXT        NOT NULL UNIQUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sculptors_name_idx ON sculptors (LOWER(name));

-- ---- series -----------------------------------------------------------------
CREATE TABLE series (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    name         TEXT        NOT NULL,
    slug         TEXT        NOT NULL UNIQUE,
    origin       TEXT        NOT NULL DEFAULT 'other'
                 CHECK (origin IN ('anime','manga','game','vn','light_novel','original','other')),
    anilist_id   INTEGER,                       -- set when Phase 2B's AniList import lands
    mal_id       INTEGER,
    description  TEXT,
    cover_url    TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX series_name_idx ON series (LOWER(name));

-- ---- characters -------------------------------------------------------------
CREATE TABLE characters (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT        NOT NULL,
    slug        TEXT        NOT NULL UNIQUE,
    series_id   UUID        REFERENCES series(id) ON DELETE SET NULL,
    portrait_url TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX characters_name_idx ON characters (LOWER(name));
CREATE INDEX characters_series_id_idx ON characters (series_id);

-- ---- figures ----------------------------------------------------------------
-- "type" reflects the category — Nendoroid / Figma / scale figure / prize / etc.
CREATE TABLE figures (
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
    scale             TEXT,                                  -- "1/7", "1/8", "non-scale"
    height_mm         INTEGER,
    materials         TEXT[]      NOT NULL DEFAULT ARRAY[]::TEXT[],
    release_date      DATE,                                  -- announced or actual release
    msrp_amount       NUMERIC(12,2),
    msrp_currency     CHAR(3),                               -- ISO 4217 ("JPY","EUR","USD")
    jan               TEXT,                                  -- JAN/EAN barcode
    exclusivity       TEXT,                                  -- "store_exclusive", "event_exclusive", NULL
    edition           TEXT,                                  -- "Standard", "Deluxe", "Limited"
    version_name      TEXT,                                  -- "Snow Princess Ver.", "Repaint", …
    official_image_url TEXT,
    description       TEXT,
    -- External catalog hints (filled by Phase 2B scrapers; nullable today)
    mfc_id            INTEGER,
    -- Author / provenance
    created_by        UUID        REFERENCES users(id) ON DELETE SET NULL,
    is_user_submitted BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX figures_name_idx        ON figures (LOWER(name));
CREATE INDEX figures_type_idx        ON figures (figure_type);
CREATE INDEX figures_manufacturer_idx ON figures (manufacturer_id);
CREATE INDEX figures_release_idx     ON figures (release_date);
CREATE UNIQUE INDEX figures_jan_uniq  ON figures (jan) WHERE jan IS NOT NULL;
CREATE UNIQUE INDEX figures_mfc_uniq  ON figures (mfc_id) WHERE mfc_id IS NOT NULL;

CREATE TRIGGER figures_updated_at
    BEFORE UPDATE ON figures
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---- figure_characters & figure_series (M2M) --------------------------------
CREATE TABLE figure_characters (
    figure_id    UUID NOT NULL REFERENCES figures(id) ON DELETE CASCADE,
    character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    PRIMARY KEY (figure_id, character_id)
);

CREATE TABLE figure_series (
    figure_id  UUID NOT NULL REFERENCES figures(id) ON DELETE CASCADE,
    series_id  UUID NOT NULL REFERENCES series(id)  ON DELETE CASCADE,
    PRIMARY KEY (figure_id, series_id)
);

-- ---- owned_items ------------------------------------------------------------
CREATE TABLE owned_items (
    id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    figure_id      UUID        NOT NULL REFERENCES figures(id) ON DELETE RESTRICT,
    condition      TEXT        NOT NULL DEFAULT 'mib_sealed'
                   CHECK (condition IN ('mib_sealed','opened_box','displayed','loose','damaged')),
    price_amount   NUMERIC(12,2),
    price_currency CHAR(3),
    store          TEXT,
    purchase_date  DATE,
    location       TEXT,                                    -- shelf / room / box label
    notes          TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX owned_items_user_id_idx   ON owned_items (user_id);
CREATE INDEX owned_items_figure_id_idx ON owned_items (figure_id);
CREATE INDEX owned_items_user_created_idx ON owned_items (user_id, created_at DESC);

CREATE TRIGGER owned_items_updated_at
    BEFORE UPDATE ON owned_items
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---- wishlist_items ---------------------------------------------------------
CREATE TABLE wishlist_items (
    user_id        UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    figure_id      UUID        NOT NULL REFERENCES figures(id) ON DELETE CASCADE,
    max_price_amount NUMERIC(12,2),
    max_price_currency CHAR(3),
    note           TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, figure_id)
);
CREATE INDEX wishlist_items_user_idx ON wishlist_items (user_id, created_at DESC);

-- ---- preorders --------------------------------------------------------------
-- A pre-order tracks a *commitment* to acquire a figure. The headline feature
-- is `release_date_current` vs `release_date_original`: every revision is logged
-- in `preorder_date_history` so the user can see how many times a release slipped.
CREATE TABLE preorders (
    id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                 UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    figure_id               UUID        NOT NULL REFERENCES figures(id) ON DELETE RESTRICT,
    status                  TEXT        NOT NULL DEFAULT 'preordered'
                            CHECK (status IN (
                                'announced','preorder_open','preordered',
                                'in_production','released','shipped','received','cancelled'
                            )),
    store                   TEXT,
    order_ref               TEXT,                                      -- order number / SKU
    release_date_original   DATE,
    release_date_current    DATE,
    price_amount            NUMERIC(12,2),
    price_currency          CHAR(3),
    notes                   TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX preorders_user_idx          ON preorders (user_id, release_date_current);
CREATE INDEX preorders_user_status_idx   ON preorders (user_id, status);
CREATE INDEX preorders_figure_idx        ON preorders (figure_id);

CREATE TRIGGER preorders_updated_at
    BEFORE UPDATE ON preorders
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---- preorder_date_history --------------------------------------------------
CREATE TABLE preorder_date_history (
    id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    preorder_id    UUID        NOT NULL REFERENCES preorders(id) ON DELETE CASCADE,
    previous_date  DATE,
    new_date       DATE,
    source         TEXT        NOT NULL DEFAULT 'user'
                   CHECK (source IN ('user','manufacturer_announcement','store_update','scraper')),
    note           TEXT,
    noted_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX preorder_date_history_preorder_idx
    ON preorder_date_history (preorder_id, noted_at DESC);

-- Logs every change to release_date_current. The application layer is
-- responsible for inserting the history row in the same transaction.

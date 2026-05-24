-- =============================================================================
-- FigureCollector — Phase 4B: achievements (sceaux)
--
-- Catalog of unlockable seals + per-user unlock log. The rules engine in
-- `domain/achievement.rs` checks thresholds after every mutation that could
-- shift a counter (owned_added, preorder_created, preorder_status_changed,
-- scan_created) and grants any newly-met achievements.
--
-- Seeded inline so a fresh database lands with the catalog populated.
-- =============================================================================

CREATE TABLE IF NOT EXISTS achievements (
    code        TEXT     PRIMARY KEY,
    category    TEXT     NOT NULL,
    tier        TEXT     NOT NULL CHECK (tier IN ('bronze', 'silver', 'gold')),
    kind        TEXT     NOT NULL,        -- pieces_owned | preorders_placed | preorders_received | scans_created
    threshold   INTEGER  NOT NULL,
    sort_order  INTEGER  NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS user_achievements (
    user_id          UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    achievement_code TEXT         NOT NULL REFERENCES achievements(code) ON DELETE CASCADE,
    unlocked_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, achievement_code)
);
CREATE INDEX IF NOT EXISTS user_achievements_user_idx
    ON user_achievements (user_id, unlocked_at DESC);

-- Seed the catalog. ON CONFLICT keeps subsequent migrations idempotent and
-- lets us tune thresholds / labels later without manual data fixes.
INSERT INTO achievements (code, category, tier, kind, threshold, sort_order) VALUES
    -- Collection size (the bread and butter)
    ('owned_first',    'collection', 'bronze', 'pieces_owned',         1,  10),
    ('owned_10',       'collection', 'bronze', 'pieces_owned',        10,  20),
    ('owned_25',       'collection', 'bronze', 'pieces_owned',        25,  30),
    ('owned_50',       'collection', 'silver', 'pieces_owned',        50,  40),
    ('owned_100',      'collection', 'silver', 'pieces_owned',       100,  50),
    ('owned_250',      'collection', 'gold',   'pieces_owned',       250,  60),
    ('owned_500',      'collection', 'gold',   'pieces_owned',       500,  70),
    ('owned_1000',     'collection', 'gold',   'pieces_owned',      1000,  80),
    -- Pre-order discipline
    ('preorder_first', 'preorder',   'bronze', 'preorders_placed',     1, 110),
    ('preorder_5',     'preorder',   'silver', 'preorders_placed',     5, 120),
    ('preorder_25',    'preorder',   'gold',   'preorders_placed',    25, 130),
    -- Preorders that actually landed (figures received)
    ('received_first', 'preorder',   'bronze', 'preorders_received',   1, 140),
    ('received_10',    'preorder',   'silver', 'preorders_received',  10, 150),
    -- Curator: 3D / 360° scans archived
    ('scan_first',     'curator',    'bronze', 'scans_created',        1, 210),
    ('scan_10',        'curator',    'silver', 'scans_created',       10, 220)
ON CONFLICT (code) DO UPDATE SET
    category   = EXCLUDED.category,
    tier       = EXCLUDED.tier,
    kind       = EXCLUDED.kind,
    threshold  = EXCLUDED.threshold,
    sort_order = EXCLUDED.sort_order;

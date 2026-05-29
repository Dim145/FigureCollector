-- Persistent display cabinets ("vitrines") for the shelf organiser.
--
-- A lightweight per-user registry of named locations, so an EMPTY cabinet can
-- exist and act as a stable drag-and-drop target. `owned_items.location` stays
-- free-text and is matched to a cabinet by name (case-insensitive) — no FK
-- migration of the existing free-text locations is needed, and any location
-- typed before it was formally created still shows up as a cabinet.
CREATE TABLE IF NOT EXISTS collection_locations (
    id         UUID        PRIMARY KEY,
    user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name       TEXT        NOT NULL,
    position   INTEGER     NOT NULL DEFAULT 100,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One cabinet per name per user (case-insensitive); enables idempotent create.
CREATE UNIQUE INDEX IF NOT EXISTS collection_locations_user_name
    ON collection_locations (user_id, lower(name));
CREATE INDEX IF NOT EXISTS collection_locations_user_pos
    ON collection_locations (user_id, position, name);

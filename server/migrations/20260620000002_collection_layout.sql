-- Free-form "atelier" shelf layout for the Vitrines planner — per-user absolute
-- placements of owned pieces on drawn shelves. The payload is opaque JSON the
-- SPA owns: { "shelves": N, "placed": { "<owned_id>": { "shelf": i, "x": 0..1 } } }.
-- One row per user, upserted wholesale on each save.
CREATE TABLE IF NOT EXISTS collection_layouts (
    user_id    UUID        PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    data       JSONB       NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

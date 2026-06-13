-- Visual search by photo (Phase 1 — data layer).
--
-- A user photographs a figure; the embedding of that photo is matched against
-- per-image embeddings of the CATALOG (never user photos). Embeddings are
-- DINOv2-small features (384-d), produced by the SAME ONNX model in the
-- browser (the query) and in the worker (the catalog index) so the vectors
-- live in one space. Distance is cosine; pgvector's HNSW index serves the ANN.
CREATE EXTENSION IF NOT EXISTS vector;

-- One row per catalog image (multi-view: a figure matches if ANY of its images
-- is a near neighbour). `image_ref` is the figure_photos UUID (as text) for an
-- uploaded catalog photo, or the official_image_url for the external one.
-- `model_version` pins which model produced the vector so a model change can
-- re-index without clashing.
CREATE TABLE IF NOT EXISTS figure_embeddings (
    id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    figure_id     UUID         NOT NULL REFERENCES figures(id) ON DELETE CASCADE,
    source        TEXT         NOT NULL,            -- 'photo' | 'official'
    image_ref     TEXT         NOT NULL,
    model_version TEXT         NOT NULL,
    embedding     vector(384)  NOT NULL,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    UNIQUE (image_ref, model_version)
);

-- HNSW over cosine: best latency/recall at our scale (<100k vectors), and the
-- per-row `ORDER BY embedding <=> q LIMIT k` query rides it directly.
CREATE INDEX IF NOT EXISTS figure_embeddings_hnsw
    ON figure_embeddings USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS figure_embeddings_figure_idx
    ON figure_embeddings (figure_id);

-- Work list of catalog images still to embed. The worker (built last) claims
-- rows, embeds, and posts the vectors back; the enqueue side (on figure/photo
-- change, and the admin "rebuild" action) exists from Phase 1 so the index can
-- be (re)built once a worker is online.
CREATE TABLE IF NOT EXISTS figure_embedding_queue (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    figure_id     UUID        NOT NULL REFERENCES figures(id) ON DELETE CASCADE,
    source        TEXT        NOT NULL,             -- 'photo' | 'official'
    image_ref     TEXT        NOT NULL,
    model_version TEXT        NOT NULL,
    state         TEXT        NOT NULL DEFAULT 'pending',  -- pending|processing|done|failed
    attempts      INTEGER     NOT NULL DEFAULT 0,
    error_message TEXT,
    enqueued_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    claimed_at    TIMESTAMPTZ,
    UNIQUE (image_ref, model_version)
);
CREATE INDEX IF NOT EXISTS figure_embedding_queue_state_idx
    ON figure_embedding_queue (state, enqueued_at);

-- Workers advertise what they can do, so we can detect a live "embed"-capable
-- worker (gates index (re)building, not querying). Existing gsplat workers
-- default to an empty set and simply won't match until their Python side
-- advertises the capability. The Python worker owns writes to this table; Rust
-- only reads it.
ALTER TABLE workers
    ADD COLUMN IF NOT EXISTS capabilities TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
CREATE INDEX IF NOT EXISTS idx_workers_capabilities ON workers USING gin (capabilities);

-- Multimodal search by description (CLIP / SigLIP — text → image).
--
-- Unlike photo search (DINOv2, image → image) and semantic search (e5,
-- text → text), this matches a TEXT query against the LOOK of catalog images:
-- the user describes a figure ("white-haired elf mage") and we find figures
-- whose image embeds nearest in a shared image+text space. The model is
-- multilingual-SigLIP2 (768-d): the WORKER embeds catalog images with its
-- vision tower, the BROWSER embeds the query with its text tower, both ONNX, so
-- the vectors live in one space. Distance is cosine; pgvector HNSW serves ANN.
--
-- SigLIP is 768-d, so it can't reuse figure_embeddings (vector(384)); it gets
-- its own table. The work list reuses figure_embedding_queue (generic on
-- model_version) — clip rows carry source 'photo'/'official' and the same
-- image_ref as DINOv2, distinguished by model_version.
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS figure_clip_embeddings (
    id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    figure_id     UUID         NOT NULL REFERENCES figures(id) ON DELETE CASCADE,
    source        TEXT         NOT NULL,            -- 'photo' | 'official'
    image_ref     TEXT         NOT NULL,
    model_version TEXT         NOT NULL,
    embedding     vector(768)  NOT NULL,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    UNIQUE (image_ref, model_version)
);

CREATE INDEX IF NOT EXISTS figure_clip_embeddings_hnsw
    ON figure_clip_embeddings USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS figure_clip_embeddings_figure_idx
    ON figure_clip_embeddings (figure_id);

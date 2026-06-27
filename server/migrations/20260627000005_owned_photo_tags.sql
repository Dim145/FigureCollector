-- Appearance tags for the user's OWN uploaded photos (WD-Tagger v3).
--
-- Mirrors figures.visual_tags (see 20260618000002_visual_tags.sql) for the
-- catalogue, but for the per-user `photos` table: a worker tags each owned
-- photo and writes the merged Danbooru-style tags here as plain text, so the
-- user can see them and filter their collection by them. The column is
-- worker-owned; nothing else writes it.
ALTER TABLE photos
    ADD COLUMN IF NOT EXISTS visual_tags TEXT;

-- Reuse the existing `figure_embedding_queue` for owned-photo tag jobs rather
-- than a parallel table: the worker's claim/lifecycle (SKIP LOCKED, attempts,
-- failure backoff) is identical. An owned-photo job has NO figure, so relax the
-- `figure_id` NOT NULL constraint — catalogue rows keep theirs; owned-photo
-- rows leave it NULL and carry the photo id in `image_ref`
-- ('owned_photo:<photo_id>'), distinguished by `source = 'owned_tags'`.
-- (The FK stays: NULL is allowed by a foreign key, so no integrity is lost.)
ALTER TABLE figure_embedding_queue
    ALTER COLUMN figure_id DROP NOT NULL;

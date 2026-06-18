-- Appearance tags for semantic search (WD-Tagger v3 → e5).
--
-- A worker tags each figure's image with Danbooru-style tags (character, hair
-- colour, outfit, "elf", "pointy_ears"…) and stores them here as plain text.
-- These tags are appended to the figure's e5 "passage" (see compose_figure_text
-- in the worker), so the existing semantic ("Sens") search finds figures by how
-- they LOOK — reusing the Batch-4 text pipeline, no new in-browser model. The
-- column is worker-owned; manual entry never writes it.
ALTER TABLE figures
    ADD COLUMN IF NOT EXISTS visual_tags TEXT;

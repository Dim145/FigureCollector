-- =============================================================================
-- Replace the hardcoded figure_type CHECK with a real FK to figure_types.
--
-- The original `figures_figure_type_check` (migration 2) froze the column to
-- ten built-in slugs. Since migration 21 promoted figure types to a
-- first-class admin-curated table, that CHECK is stale: a figure created with
-- an admin-added type (e.g. "sexdoll") passes the app-level
-- `figure_type::exists()` validation but is rejected by the DB constraint
-- (23514). This migration drops the CHECK and adds a foreign key so the DB
-- enforces "figure_type must be a real, existing type" without freezing the
-- allowed set.
--
-- ON DELETE RESTRICT mirrors the app-level guard (figure_type::delete returns
-- Conflict when a type is still referenced) — you can't delete a type out
-- from under the figures using it.
-- =============================================================================

-- 1. Drop the stale hardcoded CHECK.
ALTER TABLE figures DROP CONSTRAINT IF EXISTS figures_figure_type_check;

-- 2. Defensive backfill: if any figure somehow references a type not present
--    in figure_types (data drift from before the entity existed), mint a
--    placeholder row so the FK below can be added without failing. Normal
--    installs hit zero rows here — the 10 built-ins were seeded in migration
--    21 and admin-created types already live in figure_types.
INSERT INTO figure_types (id, label_fr, label_en, kanji, position)
SELECT DISTINCT f.figure_type, f.figure_type, f.figure_type, '？', 500
FROM figures f
LEFT JOIN figure_types ft ON ft.id = f.figure_type
WHERE ft.id IS NULL
ON CONFLICT (id) DO NOTHING;

-- 3. Add the FK (idempotent: drop-then-add so re-runs don't error).
ALTER TABLE figures DROP CONSTRAINT IF EXISTS figures_figure_type_fkey;
ALTER TABLE figures
    ADD CONSTRAINT figures_figure_type_fkey
    FOREIGN KEY (figure_type) REFERENCES figure_types(id) ON DELETE RESTRICT;

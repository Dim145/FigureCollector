-- Migration — figure_types.accent_color
--
-- Per-type signature accent colour, admin-editable from /admin/figure-types.
-- NULLABLE: a null value means "use the built-in per-theme default" (the
-- `--type-<slug>` CSS custom properties shipped in the SPA, which differ
-- between the dark and light themes). A non-null value is a single CSS colour
-- string (hex / oklch / rgb / name); the SPA injects it as a `--type-<slug>`
-- override that applies to BOTH themes.
--
-- No seed on purpose: leaving every row null keeps the current per-theme
-- defaults, so the visible colours are unchanged until an admin customises one.

ALTER TABLE figure_types ADD COLUMN IF NOT EXISTS accent_color TEXT;

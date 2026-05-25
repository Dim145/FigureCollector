-- =============================================================================
-- 15) Achievement → trigger figure
--
-- Each unlock is now associated (when possible) with the figurine that pushed
-- the user over the threshold. The /achievements page uses this to display
-- the actual figure photo on the seal — a far more meaningful trophy than a
-- generic kanji glyph.
--
-- Nullable: not every unlock has a clean trigger (e.g. legacy rows, or
-- future achievement kinds untied to a single figure).
-- =============================================================================

ALTER TABLE user_achievements
    ADD COLUMN IF NOT EXISTS trigger_figure_id UUID
        REFERENCES figures(id) ON DELETE SET NULL;

-- Backfill — for every existing unlock, look up the figurine that was the
-- Nth chronologically-relevant entity at the time. This best-effort fill
-- means old unlocks aren't visually orphaned in the redesigned page.
--
-- Threshold N matches the chronological position (1-indexed). If the user
-- has fewer rows than N (achievement granted via off-band tooling or test
-- data), trigger_figure_id stays NULL.

UPDATE user_achievements ua
SET trigger_figure_id = sub.figure_id
FROM (
    SELECT ua_inner.user_id, ua_inner.achievement_code,
           CASE a.kind
                WHEN 'pieces_owned'        THEN (
                    SELECT o.figure_id FROM owned_items o
                    WHERE o.user_id = ua_inner.user_id
                    ORDER BY o.created_at ASC
                    OFFSET GREATEST(a.threshold - 1, 0) LIMIT 1
                )
                WHEN 'preorders_placed'    THEN (
                    SELECT p.figure_id FROM preorders p
                    WHERE p.user_id = ua_inner.user_id
                    ORDER BY p.created_at ASC
                    OFFSET GREATEST(a.threshold - 1, 0) LIMIT 1
                )
                WHEN 'preorders_received'  THEN (
                    SELECT p.figure_id FROM preorders p
                    WHERE p.user_id = ua_inner.user_id AND p.status = 'received'
                    ORDER BY p.updated_at ASC
                    OFFSET GREATEST(a.threshold - 1, 0) LIMIT 1
                )
                WHEN 'scans_created'       THEN (
                    SELECT o.figure_id FROM scans s
                    JOIN owned_items o ON o.id = s.owned_item_id
                    WHERE o.user_id = ua_inner.user_id
                    ORDER BY s.created_at ASC
                    OFFSET GREATEST(a.threshold - 1, 0) LIMIT 1
                )
           END AS figure_id
    FROM user_achievements ua_inner
    JOIN achievements a ON a.code = ua_inner.achievement_code
    WHERE ua_inner.trigger_figure_id IS NULL
) sub
WHERE ua.user_id = sub.user_id
  AND ua.achievement_code = sub.achievement_code
  AND sub.figure_id IS NOT NULL;

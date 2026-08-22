-- Two-axis condition grading (QW11) — the item and its box are separate goods.
--
-- `owned_items.condition` is a single 5-value enum that has to express both
-- "the box is crushed" and "the paint is chipped". For a figure they are
-- different assets: a JP exclusive with a crushed box loses 30-40%, a torn seal
-- can halve the value, and a MIB out-of-production piece appreciates faster
-- than a loose one.
--
-- Additive on purpose. `condition` keeps its current meaning and stays the
-- field every existing surface reads (exports, achievements, public vitrines,
-- La Cote), so nothing downstream changes behaviour. The grades are extra
-- metadata the UI can show and the owner can filter on.
--
-- Scale: the Japanese used-market / Goldmine-style ladder the hobby already
-- speaks — A+ (mint) → A → A- → B+ → B → C → J (junk).
--
-- Deliberately NOT wired into valuation: any grade-to-price coefficient would
-- be invented, and silently overwriting a user's own valuation with a guess is
-- worse than showing no number.
ALTER TABLE owned_items
    ADD COLUMN IF NOT EXISTS condition_item CHAR(2)
        CHECK (condition_item IS NULL OR condition_item IN ('A+','A','A-','B+','B','C','J')),
    ADD COLUMN IF NOT EXISTS condition_box  CHAR(2)
        CHECK (condition_box  IS NULL OR condition_box  IN ('A+','A','A-','B+','B','C','J')),
    ADD COLUMN IF NOT EXISTS completeness   TEXT
        CHECK (completeness IS NULL
               OR completeness IN ('complete','missing_parts','box_only','no_box'));

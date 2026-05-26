# Achievements & stats

## Achievements

Achievements are **milestone seals** (印, *in*) the user collects as their collection grows. Each unlocked seal fires the `achievement_unlocked` notification event, surfaces in the bell popover, and appears on `/achievements`.

Examples (the exact list lives in `server/src/domain/achievement.rs`):

- **First piece** — your first owned_item.
- **Manufacturer × N** — own N pieces from the same manufacturer.
- **Series × N** — own N pieces from the same series.
- **NSFW collector** — own M pieces marked NSFW (only when the user has `nsfw_visibility ≠ hide`).
- **Slipped survivor** — own a figurine whose preorder slipped ≥ 3 times.

Each achievement has a **tier** (bronze / silver / gold) that escalates as the count rises. The kanji glyph + tier color render on the achievements page.

## Year-in-review

`/year-in-review/<year>` produces an annual recap with:

- **Pieces acquired** — count of new owned_items added in the year.
- **Dépenses** — sum of `price_amount` per currency, with a "Pertes sur annulations" sub-block below painted in laque-red showing the net loss on cancelled preorders that year.
- **Fabricant favori** — most-common manufacturer this year.
- **Série favorite** — most-common series.
- **Sortie la plus repoussée** — preorder with the most slips in the year (with the original → current date delta).
- **Pièces par mois** — monthly histogram.
- **Première / dernière acquisition** — bookends of the year.

The page is intentionally print-friendly — you can print it as a yearly summary or export the layout to PDF via the browser.

## Statistics

`/statistics` (work in progress) layers a more analytical view on top of the data: spend over time, condition distribution, top scales, etc.

Both surfaces are read-only — they aggregate from the existing tables, no separate cache.

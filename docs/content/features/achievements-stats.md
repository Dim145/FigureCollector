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
- **Dépenses** — the year's spend (shown in [your display currency](currency.md),
  per-currency underneath), with a "Pertes sur annulations" sub-block below
  painted in laque-red showing the net loss on cancelled preorders that year.
- **Fabricant favori** — most-common manufacturer this year.
- **Série favorite** — most-common series.
- **Sortie la plus repoussée** — preorder with the most slips in the year (with the original → current date delta).
- **Pièces par mois** — monthly histogram.
- **Première / dernière acquisition** — bookends of the year.
- **L'année en regard** — a side-by-side comparison with the previous year (pieces & spend).

The page is intentionally print-friendly — you can print it as a yearly summary or export the layout to PDF via the browser.

## Stats & insights

`/stats` layers an analytical view over your data, in chapters:

**Headline counters** — pieces, distinct types / manufacturers / series, 3D
scans, pre-order lifecycle counts.

**Dépenses cumulées** — the spend ledger, per currency (item cost, shipping,
catalogue reference with a *saved / over catalogue* delta). With
[display-currency conversion](currency.md) on, it leads with a single
**≈ toutes devises confondues** total — costs counted at their
purchase-time frozen rate, the same figure La Cote's *total payé* shows.

**Insights** — the deeper cuts:

- **Dépense par année** — spending per year, per currency.
- **Complétion de séries** — how complete each owned series is (owned vs catalogue).
- **Coût des souhaits** — the estimated cost of your [wishlist](wishlist.md), per currency.
- **Santé des pré-commandes** — open deposits, average slip days, open vs cancelled counts.

**Distribution des prix** — min / median / average / max paid per currency,
with a histogram; plus the **most expensive piece** per currency.

**Breakdowns** — by figure type, by condition, top manufacturers / series /
sculptors, acquisitions per year.

## Prochain palier

The achievements page also surfaces your **next milestone** — the closest
unearned seal and exactly how many pieces / pre-orders / … remain to unlock it.

All of these surfaces are read-only — they aggregate from the existing tables,
with no separate cache.

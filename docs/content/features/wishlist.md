# Wishlist (souhaits)

`/souhaits` is the list of catalogue figures you covet but don't own yet — each
with an optional **target price** (*cible*) and a note.

## Target price & budget

Set a target per piece; the header sums them into a **targets budget** (dominant
currency). When a figure's MSRP sits at or below your target, its card flags the
deal.

## Acquérir

"Acquérir" moves a wished figure into your [collection](catalogue.md) — and the
server auto-creates a [pre-order](preorders.md) when the figure isn't out yet.

## Owned ≠ wishlist

A figure you already own can't also be wished:

- Adding a figure to your collection **automatically removes** it from your
  wishlist.
- The *add to wishlist* control is hidden on a figure you already own, and the
  API refuses to wishlist an owned figure.

On the [catalogue](catalogue.md) cards this shows as a **single** corner marker,
in priority order: **pre-order badge › owned seal (✓) › wished heart (♥)** — a
card never stacks two.

## Bulk import from orzgk

The **Importer** button opens `/souhaits/import`, which bulk-adds figures from a
**public orzgk wishlist**:

1. **Coller** — paste your list's public share link (on orzgk: *Share → Public →
   copy the link*, e.g. `…/wishlist-2/view/<token>/`). The server fetches it,
   following pagination. You can also paste product links (one per line); the
   page HTML of a private list is accepted as a fallback.
2. **Choisir** — each parsed item is matched against the catalogue by name +
   manufacturer (trigram similarity). A **≥ 90 %** match auto-links to the
   existing figure; below that you pick the match or "create new". Figures you
   already own or already wish are locked out. Select up to **10 per batch**.
3. **Importer** — matched figures are simply added to your wishlist (no metadata
   touched); new ones are created in the catalogue from the orzgk product page —
   the same mapping as the [add-figure import](url-import.md), with your chosen
   version pre-selected — and then wished.

!!! note "Why a batch of 10"
    Creating a not-yet-catalogued figure costs one orzgk product fetch each, so a
    single import run is capped at 10 items. Re-run it for the rest — already-
    imported pieces show as *déjà souhaitée* and are skipped.

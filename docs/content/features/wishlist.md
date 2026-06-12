# Wishlist (souhaits)

`/souhaits` is the list of catalogue figures you covet but don't own yet — each
with an optional **target price** (*cible*) and a note.

## Target price & budget

Set a target per piece; the header sums them into a **targets budget**, shown
in [your display currency](currency.md) with the ≈ marker. When a figure's
market price or MSRP sits at or below your target, its card flags the deal.

## Price alerts

Targets aren't just decorative — the [market-price sweep](cote.md#market-prices-auto-tracked)
checks them on every run. When a figure's fetched price lands **at or below
your target**, a `wishlist_price_below_target` notification fires through
whatever [channels](notifications.md) you routed it to: the in-app bell,
email, ntfy, push… The comparison is **cross-currency** — a €50 target catches
a $45 price, both converted through today's ECB rate (the same conversion
behind [the deal badge](#target-price-budget) on the cards).

Each **price level** notifies once — you won't be re-pinged every sweep at the
same price, but a further drop fires again. No cron scheduled by the admin →
no alerts (the wishlist still flags deals against the catalogue MSRP).

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

## Bulk import

The **Importer** button opens `/souhaits/import`, which bulk-adds figures from
three kinds of sources:

- a **public orzgk wishlist** (native scraper),
- a **public wishlist on any boutique your [proxy](url-import.md) handles** —
  the SPA routes the pasted URL by host against the proxy's `/stores` list and
  fetches it through the proxy's optional `/wishlist` endpoint,
- an **MFC CSV export** — on MyFigureCollection: *Manager → CSV Export* (also
  available on lists, so your *Wished* tab too). The file is parsed locally —
  no connection to MFC, no Cloudflare — and rows carrying a barcode are
  matched **by JAN first** (exact), which beats any title similarity.

1. **Coller** — paste the list's public share link (orzgk: *Share → Public →
   copy the link*; or any proxy-handled boutique). You can also paste product
   links (one per line) or the page HTML of a private orzgk list — or drop the
   MFC CSV file in the well below the textarea. A "detected source" chip row
   shows which path the dispatcher picked.
2. **Choisir** — each parsed item is matched against the catalogue (exact JAN
   when available, else name + manufacturer trigram similarity). A **≥ 90 %**
   match auto-links to the existing figure; below that you pick the match or
   "create new". Figures you already own or already wish are locked out.
   Select up to **25 per batch**.
3. **Importer** — matched figures are simply added to your wishlist (no
   metadata touched); new ones are created per source: orzgk and proxy items
   from their product page (the same mapping as the
   [add-figure import](url-import.md), version pre-selected), MFC rows as a
   minimal figure (name + JAN, the MFC link kept in the description — enrich
   later) — and then wished.

!!! note "Why a batch of 25"
    Creating a not-yet-catalogued figure costs one product fetch each, so a
    single import run is capped at 25 items. Re-run it for the rest — already-
    imported pieces show as *déjà souhaitée* and are skipped.

## Shared gift lists

Turn your wishlist into a **public gift list** so friends and family can
coordinate presents — no account required on their end.

From `/souhaits`, **Créer le lien** mints a share link (`/g/<token>`); **Arrêter
le partage** kills it and wipes every reservation. Anyone with the link sees your
wished pieces and can **claim** one by typing a name — the secret that lets them
release it later lives in their browser, so no sign-in is needed. Other
gift-givers see *réservé · «name»*, so two people don't buy the same thing. It's
the SPA's only anonymous route (it renders without a session, no login redirect).

!!! note "The surprise is safe"
    **Reservations are hidden from you** — even on your own link. You only ever
    see the link, never who claimed what.

NSFW pieces never surface on the public link unless **you** expose NSFW on your
[public profile](social.md) *and* the viewer opts in — their own
[NSFW setting](nsfw.md) when signed in, a local *Afficher le contenu sensible*
toggle when anonymous.

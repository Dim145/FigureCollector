# Wishlist (souhaits)

`/souhaits` is the list of catalogue figures you covet but don't own yet — each
with an optional **target price** (*cible*) and a note.

## Target price & budget

Set a target per piece; the header sums them into a **targets budget**, shown
in [your display currency](currency.md) with the ≈ marker. When a figure's
market price or MSRP sits at or below your target, its card flags the deal.

## Is it a deal? { #target-comparison }

The comparison is routinely cross-currency — a €200 target beside a $239 shop
price — so the answer is computed **server-side** and travels with each row as
`target_comparison`:

| Field | Meaning |
|---|---|
| `met` | Whether the target is met. |
| `priced_from` | Which price was measured: `provider` (latest observed shop price) or `msrp` (the catalogue list price, when no shop price exists). |
| `basis` | `same_currency`, `converted_via_eur`, or `target_adopts_observed` for a target you entered without a currency. |
| `amount_eur` / `target_eur` | Both sides in euros, to the cent — present only when a conversion actually happened. |
| `fx_date` | The rate table's date, so the verdict can be checked later. |

It is absent when there is no target, no price to measure, or no rate bridging
the two currencies — an honest "can't tell" rather than a wrong verdict.

This matters most for an [assistant over MCP](mcp.md), which has no rate table
of its own: without it, `149.99 USD` against a `150.00 EUR` target reads as a
deal by one cent, when the real margin is about twenty euros.

The euro figures are rounded for reading; the verdict is decided on the
unrounded values, so a price a hair over your target never rounds its way onto
it.

## Price alerts

Targets aren't just decorative — the [market-price sweep](cote.md#market-prices-auto-tracked)
checks them on every run. When a figure's fetched price lands **at or below
your target**, a `wishlist_price_below_target` notification fires through
whatever [channels](notifications.md) you routed it to: the in-app bell,
email, ntfy, push… The comparison is **cross-currency** — a €50 target catches
a $45 price, both converted through today's ECB rate (the same conversion
behind [the deal badge](#target-price-budget) on the cards).

An alert fires on the **crossing**, not on the level: once a price drops
through your target you are told once, and then it goes quiet for as long as
it stays below. If it climbs back above and drops again, that is a new
crossing and you hear about it again.

!!! note "It used to fire on the level"
    Alerts used to key on the price *level*, so any movement below your target
    counted as a fresh event — a shop wobbling €161.19 → €160.85 → €161.19
    pinged you three times, and one figure could produce ten notifications
    over a few weeks for a target it had crossed once.

The payload carries how the comparison was made — `comparison_basis`, plus
`amount_eur`, `target_eur` and the rate table's `fx_date` when the two sides
were in different currencies — so a "$161.19 against a €150.00 target" alert
can be checked rather than taken on trust.

Figures that **every shop reports out of stock** don't alert: a price drop you
cannot act on is noise, and [the restock alert](#back-in-stock) already covers
the moment it becomes buyable. No cron scheduled by the admin → no alerts (the
wishlist still flags deals against the catalogue MSRP).

## Back in stock { #back-in-stock }

The same sweep reads each shop's **availability**, so a boutique that quietly
restocks a wished figure wakes you rather than waiting to be noticed. A
`wishlist_back_in_stock` notification fires when a shop's signal flips from a
**known** out-of-stock to buyable — `in_stock`, or `preorder` reopening.

"Known" is the load-bearing word: a figure the sweep has never priced has no
previous state to have flipped, so a first observation never alerts. And a
listing that flaps in and out is deduplicated per figure, per shop, per day —
at most one ping a day from a flickering shop, while a genuine restock months
later still fires.

Each wishlist card also shows its current availability, and the list gains an
*in stock* lens; a row whose shop stopped refreshing ages back to *unknown*
after seven days rather than lying about being in stock.

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

# La Cote (collection value)

`/cote` is the **value dashboard** — what your collection is worth today versus
what you paid for it, with the market doing most of the valuation work for you.

## Effective value

Each piece's value is resolved, in order:

1. a **manual value** you set (`value_amount` — the *cote*), else
2. the latest **market price** auto-fetched by the price sweep (badge
   *marché*), **if it is less than 30 days old**, else
3. the figure's catalogue **MSRP** as a fallback, else
4. nothing (the piece isn't counted).

!!! note "Why an observed price expires"
    The sweep revisits a figure every couple of days, so a price it hasn't
    refreshed in a month means the listing stopped resolving — delisted, sold
    out, renamed. The last thing that shop asked is then a historical fact,
    not what the piece is worth today, and a single stale observation can
    carry a large share of a reported plus-value on its own. Stale prices fall
    through to the MSRP and are counted in `valuation.pieces_stale`, so a
    value that drops is explainable rather than mysterious. A collection whose
    `pieces_stale` is large is telling you the sweep has stopped reaching
    those shops — not that the shelf lost value.

The *pièces évaluées* counter breaks those tiers down (manual / market / MSRP),
so you always know how much of the total rests on real numbers.

### Reading the plus-value honestly { #valuation-basis }

Tiers 2 and 3 are *someone else's* number: a shop's asking price, or the
manufacturer's list price. When a collection has no manual values at all, the
"plus-value" it shows is not a resale estimate — it is the gap between what you
paid and what the piece lists for, which for a full-price MSRP purchase is
mechanically ~0.

So the totals carry the basis with them. `GET /api/me/stats` answers with a
`valuation` block beside the EUR totals:

| Field | Meaning |
|---|---|
| `basis` | Whichever tier backs the most pieces: `manual`, `market`, `msrp_fallback`, or `none`. |
| `manual_coverage` | Share of pieces you valued yourself, 0.0–1.0. At `0.0`, read `plus_value` as a list-price comparison, not a gain. |
| `pieces_total` / `pieces_valued` | How much of the collection is counted at all. |
| `pieces_auto` / `pieces_msrp` | The market and MSRP tiers, split out. |
| `pieces_stale` | Pieces that have an observed price too old to use, valued at MSRP instead. |

The page has always shown the *pièces évaluées* tiers; this is the same
statement in a form a client — the SPA, an export, an
[assistant over MCP](mcp.md) — can act on without parsing prose.

## What it shows

- **Valeur estimée** — the collection's effective value in large type, in
  [your display currency](currency.md) (the per-currency originals stay in the
  footnote).
- **Payé** — the figure **price** you paid (`price_amount`, deposit included),
  converted with each purchase's **frozen exchange rate** — see
  [the drift-free plus-value](currency.md#frozen-at-purchase-the-drift-free-plus-value).
  **Shipping is deliberately excluded** here: it's a sunk cost a resale never
  recovers, so folding it in would show every shipped piece at a perpetual
  loss. (Your full outlay incl. shipping lives in the
  [stats spend ledger](achievements-stats.md).)
- **Plus-value** — value − price, with a % badge: jade for a gain, laque-red
  for a loss. Measured against the **price**, never the total outlay; the API
  states which with `eur.plus_value_basis: "cost_ex_shipping"`, because the
  same response also carries `spend` and `spend − value` is a different number
  that looks just as plausible.
- A **ranked table** of every valued piece (highest first); each row shows
  price vs estimated vs the per-piece delta, plus a market sparkline.

## Market prices, auto-tracked

When the admin schedules the [price sweep](admin.md), FigureCollector keeps
your cote current on its own:

- The sweep visits each owned figure's **buy links** — orzgk natively, any
  other boutique through the [proxy](url-import.md) — and records the best
  match (preferring your figure's exact *version*).
- The latest price feeds the value chain above; **every change is historized**
  (`figure_price_history`), never overwritten.

That history powers three reads on the page:

| Surface | What it tells you |
|---|---|
| **Per-row sparkline** | The figure's price trend at a glance, with a ▲/▼ % delta. |
| **Registre** (click a sparkline) | The full step-curve + dated ledger of every recorded price. |
| **Évolution** chart | The whole collection's value reconstructed over time (manual values and MSRPs contribute as constants, market prices as their step series), with 3m / 6m / 1y / all ranges. |

A market price at or below a wishlist target also fires a
[price alert](wishlist.md#price-alerts) — same sweep, same data.

## Editing a value

Click a row to set or clear its manual value inline (a currency-prefixed
input; a *reset to MSRP* button clears the override). Saving
(`PUT /me/owned/{id}/value`) refreshes the table and the dashboard totals
immediately. A manual value always **wins over** the market price — the sweep
never touches your numbers.

## One currency, originals preserved

Everything on the page reads in your display currency with the discreet **≈**
marker; hover any converted figure for its original. The mechanics — supported
currencies, ECB rates, the rate frozen at purchase, the EUR-normalised
plus-value — live on the [Money & currencies](currency.md) page.

The same effective-value logic powers the per-cabinet totals on
[Vitrines](vitrines.md) and the opt-in value on your public
[collector profile](social.md).

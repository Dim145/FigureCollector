# La Cote (collection value)

`/cote` is the **value dashboard** — what your collection is worth today versus
what you paid for it, with the market doing most of the valuation work for you.

## Effective value

Each piece's value is resolved, in order:

1. a **manual value** you set (`value_amount` — the *cote*), else
2. the latest **market price** auto-fetched by the price sweep (badge
   *marché*), else
3. the figure's catalogue **MSRP** as a fallback, else
4. nothing (the piece isn't counted).

The *pièces évaluées* counter breaks those tiers down (manual / market / MSRP),
so you always know how much of the total rests on real numbers.

## What it shows

- **Valeur estimée** — the collection's effective value in large type, in
  [your display currency](currency.md) (the per-currency originals stay in the
  footnote).
- **Total payé** — what you actually paid (`price_amount + shipping_amount`),
  converted with each purchase's **frozen exchange rate** — see
  [the drift-free plus-value](currency.md#frozen-at-purchase-the-drift-free-plus-value).
- **Plus-value** — value − paid, with a % badge: jade for a gain, laque-red
  for a loss.
- A **ranked table** of every valued piece (highest first); each row shows
  paid vs estimated vs the per-piece delta, plus a market sparkline.

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

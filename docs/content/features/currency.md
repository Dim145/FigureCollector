# Money & currencies

Every amount in FigureCollector — purchase price, shipping, deposit, MSRP,
manual valuation, wishlist target — is **stored in its own currency and never
mutated**. What changed in v0.23 is the *reading* side: the app now shows
everything in **one display currency of your choosing**, converted on the fly,
with the original always one hover away.

## The supported currencies

`EUR · USD · JPY · GBP · CHF · CAD`

The list lives **server-side** (`GET /api/currencies`) and is enforced as a
whitelist on every money write — price, valuation, MSRP, wishlist target,
pre-order. Junk codes (`BTC`, `XXX`, lowercase) are rejected with a `400`, so
un-convertible amounts can't sneak into your data. Every currency picker in
the SPA is fed from this single endpoint; ECB publishes rates for all six, so
anything you can select is convertible.

## One display currency

Your **default currency** (*Settings → Devise*) plays a double role:

1. the currency pre-selected in every price form, and
2. the **display currency** every other amount converts into.

Conversion is **on by default** — set a default currency and the whole app
reads in it. A single toggle underneath flips the behaviour:

| Toggle | Behaviour |
|---|---|
| **Tout afficher dans ma devise** (default) | Amounts in another currency are converted at today's ECB rate, marked **≈**. |
| **Garder les devises d'origine** | Every amount stays in its own currency, exactly as recorded. |

No default currency set → nothing converts; amounts render natively. There is
no separate "display currency" picker and no manual rate table to maintain —
both were removed in the v0.23 refonte.

## The ≈ marker

A converted amount is whisper-quiet about it: a small gold **≈** prefix and a
dotted underline. **Hover it and the original appears** (`≈ 47,67 €` →
*55 $US*). Summed totals that merge several currencies carry the ≈ without a
hover original (there isn't a single one to show).

Formatting follows each currency's real minor units via `Intl` — yen render
with **no decimals** (`8 981 JPY`, not `8 980,50 JPY`), euros with at most two.

## Rates

- Source: **European Central Bank** reference rates via
  [frankfurter.dev](https://frankfurter.dev) — free, keyless, HTTPS (Rustls).
- Fetched **EUR-anchored** (one table covers every pair), cached **12 h**
  server-side in `external_lookups`, refreshed daily by the ECB.
- The rate table's **date** is shown next to converted totals
  (*approx · converti · 2026-06-11*).
- Rates unavailable? Amounts simply render natively — conversion is a reading
  layer, never a dependency.

## Frozen at purchase — the drift-free plus-value

Converting everything at *today's* rate has a trap: your **cost** would drift
with the market. A ¥20,000 figure bought when the yen was strong "cost" you
more euros than the same ¥20,000 converted today — and a naive conversion
would silently inflate your apparent gain.

So since v0.23, **cost freezes its exchange rate at save time**:

- Recording a price on an owned piece or a pre-order captures the current
  *currency → EUR* rate into the row (`price_fx_rate`). One rate covers the
  row's price + shipping (and a pre-order's deposit + refund, which share its
  currency).
- Editing other fields **never re-freezes** the rate; only an actual currency
  change does.
- Rows that predate v0.23 have no frozen rate and gracefully fall back to
  today's rate.

The server then normalises everything to EUR (`/api/me/stats` → `eur` block):

| Figure | Rate used |
|---|---|
| **Cost** (figure price, MSRP fallback — **shipping excluded**) | the rate **frozen at purchase** (today's as fallback) |
| **Value** (manual cote › market price › MSRP) | **today's** rate |
| **Plus-value** | value − cost, both in EUR — shipping is a sunk cost kept out (a resale recovers the figure's value, not the postage), and no FX drift on the cost side |

The full **outlay** (price + shipping) is reported separately as the
[stats spend ledger](achievements-stats.md) total — it's what left your wallet,
distinct from the figure cost the plus-value is measured against.

The result feeds the headline figures on [La Cote](cote.md) and the
*toutes devises confondues* total on the [stats page](achievements-stats.md).
If some amount ever can't be converted (its currency missing from the rate
table), the total is flagged *partiel* rather than silently wrong.

!!! note "Reading layer, honest data"
    Conversion never rewrites your rows. Exports, the API, and the per-piece
    detail always carry the **original amount + currency**; the frozen rate is
    an extra column, not a replacement.

## Scraped prices — the import rule

Prices arriving from **outside** ([URL import](url-import.md), the wishlist
bulk import, the [market-price sweep](cote.md#market-prices-auto-tracked)) may
be in any currency a shop uses. They are normalised **before anything is
saved or pre-filled**, so only supported currencies ever enter your data:

- a supported currency is kept as-is;
- a real but unsupported one (HKD, CNY, KRW…) is **converted to USD** at
  today's ECB rate — the price picker keeps the shop price as provenance
  (`≈ $63.53 · HK$500`);
- a missing or unparseable currency is **assumed to be USD** (the most common
  case for international boutiques), amount unchanged;
- an unconvertible one (absent from the ECB table, e.g. TWD) is **dropped** —
  a wrong amount is worse than no amount.

The exact contract a scraping proxy must follow is documented in
[URL import → Currencies](url-import.md#currencies).

## Where it applies

Every price surface converts: La Cote (hero, KPIs, rows), the stats spend
ledger, collection & vitrine values, wishlist budget + targets, pre-order
deposits, the figure page (paid / value / gain and the price-breakdown
popover), public collector profiles, and the year-in-review.

Two things intentionally stay native:

- **Market-price history charts** — a historical series converted at *today's*
  rate would misrepresent what the figure was worth at the time.
- **MSRP hints next to price inputs** — they pre-fill the form in the
  figure's own currency; showing them converted would mismatch what the click
    inserts.

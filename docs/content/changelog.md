# What's new

The notable user-facing changes per minor version. Patch releases and the full
detail live in the [git history](https://github.com/Dim145/FigureCollector/commits/main).

## 0.23 — one currency, honest gains

- **One display currency everywhere** — your default currency doubles as the
  display currency; everything else converts at today's ECB rate, **on by
  default**, marked ≈ with the original on hover. The old display-currency
  picker + manual rate overrides are gone. → [Money & currencies](features/currency.md)
- **FX rate frozen at purchase** — cost keeps the rate captured when it was
  recorded, so the plus-value stops drifting with the market.
- **Currency whitelist** (EUR/USD/JPY/GBP/CHF/CAD) enforced on every money
  write; pickers feed from `GET /api/currencies`.
- Yen format fixed (no more `8 980,50 JPY`).
- **Wishlist price alerts** — a market price at or below your target fires a
  notification through your routed channels. → [Wishlist](features/wishlist.md#price-alerts)
- **Mobile bottom tab bar** — five-tab PWA navigation on phones. → [PWA](features/pwa.md#mobile-navigation)

## 0.21 — import from anywhere

- **Wishlist bulk import** extended to **proxy-handled boutiques** and **MFC
  CSV exports** (parsed locally, JAN-first matching) alongside public orzgk
  wishlists. → [Wishlist](features/wishlist.md#bulk-import)
- **Version picker for proxy products** — multi-version products (Regular/EX)
  prompt for the version before import, like orzgk ones.

## 0.20 — prices over time

- **Market-price history** — every price-sweep change is historized; La Cote
  grows per-figure sparklines, an expandable price registre, and a
  collection-evolution curve. → [La Cote](features/cote.md)

## 0.19 — auditable cron

- **Server job history** — every scheduled job run (price sweep, release
  notifications, scan cleanup, manga sync) is recorded with state, result
  summary, and errors; admins can re-trigger any job manually.
  → [Administration](features/admin.md)

## 0.17 – 0.18 — operator controls

- **Admin settings page** — instance policies in the UI, no env vars:
  - **3D creation policy** — gate GPU-heavy gsplat reconstructions to admins
    (default) or open them to everyone.
  - **Market-price cron** — schedule the price sweep with a cron expression;
    applies live.
- **Auto-priced cote** — the price sweep fills a market price for every owned
  figure with a buy link (orzgk natively, anything else through the proxy),
  slotting between your manual valuation and the MSRP fallback.

## 0.16 — staging the shelf

- **Diorama mode** for vitrine cabinets + cutout photos in the diorama.
- **"À la une"** — pin a featured piece atop the collection.
- Editorial spread layout for the figure page; gsplat reconstruction-quality
  options.

## 0.15 — manga synergy

- **MangaCollector cross-linking** over an admin-curated server allow-list;
  figures and manga meet via the series' MAL id. → [MangaCollector synergy](features/manga.md)
- Relicensed to **MIT** (0.14.1).

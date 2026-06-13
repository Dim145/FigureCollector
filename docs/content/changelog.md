# What's new

The notable user-facing changes per minor version. Patch releases and the full
detail live in the [git history](https://github.com/Dim145/FigureCollector/commits/main).

## 0.25 — find it by photo

- **Search the catalog by photo** — photograph a figure and FigureCollector
  finds the matching catalog entry. The visual fingerprint is computed **in your
  browser** (DINOv2-small), so the photo never leaves your device — only an
  anonymous 384-number signature travels to find the piece.
  → [Photo search](features/visual-search.md)
- **Optional web fallback** — when nothing in the catalog matches, you can
  choose to extend the search to the web (Google Vision). This is **opt-in and
  explicit**: it's the one path where the photo is sent off-device, and it
  returns identification leads (a best guess, recognised terms, matching pages)
  to help you add the piece by hand. Admin-configured, off by default.
  → [Photo search](features/visual-search.md#web-fallback)
- **Admin**: a single toggle enables photo search; a dedicated **embed-worker**
  (CPU-friendly, no GPU) builds the catalog index, and new figures/photos are
  indexed automatically. → [Photo search](features/visual-search.md#admin)

## 0.24 — imported prices, normalised

- **Scraped prices land in supported currencies only** — imports (orzgk,
  proxy boutiques, wishlist bulk import) and the market-price sweep normalise
  before saving: exotic currencies (HKD, CNY, KRW…) convert to **USD at
  today's ECB rate** with the shop price kept as provenance, a missing
  currency is **assumed USD**, an unconvertible one drops the price rather
  than store a wrong amount. → [Money & currencies](features/currency.md#scraped-prices-the-import-rule)
- **Proxy contract**: price objects should now report the shop's ISO 4217
  currency — proxies that don't keep working (amounts read as USD).
  → [URL import](features/url-import.md#currencies)
- **Wishlist price alerts are now cross-currency** — a €50 target catches a
  $45 price (both converted through today's ECB rate), instead of only firing
  on an exact currency match. Same for the deal badge on the cards.
  → [Wishlist](features/wishlist.md#price-alerts)
- **Plus-value excludes shipping** — the latent gain now compares value against
  the figure **price** only (deposit included), not price + shipping. Shipping
  is a sunk cost a resale never recovers; counting it showed every shipped
  piece at a perpetual loss. Your full outlay still shows in the stats spend
  ledger. → [Money & currencies](features/currency.md#frozen-at-purchase-the-drift-free-plus-value)
- **The add-page lookup names its sources** — opening the figure search now
  lists the exact supported shops (orzgk + every proxy boutique), each a
  clickable link to the store, doubling as what you can search and which
  product links you can paste. MFC sits apart as paste-only (its search is
  Cloudflare-blocked). → [URL import](features/url-import.md#configuring-the-proxy)

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

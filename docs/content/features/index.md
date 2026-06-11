# Features

FigureCollector is built around a small set of overlapping mental models:

- **Catalogue** — the shared figure dataset (everyone sees the same figures, manufacturers, series).
- **Collection** — *your* layer on top: prices, condition, store, notes — arranged into cabinets ([Vitrines](vitrines.md)) and valued in [La Cote](cote.md).
- **Money** — every amount stored in its own currency, all of them **read in one** ([Money & currencies](currency.md)), with the cost's exchange rate frozen at purchase.
- **Wishlist** — figures you covet but don't own yet (mutually exclusive with the collection), with [price alerts](wishlist.md#price-alerts) when the market dips below your target.
- **Pre-order lifecycle** — preorder → shipped → delivered → received, with deposit & refund accounting along the way.
- **Photos** — both catalogue-side (shared) and personal (yours).
- **Collectors** — an opt-in social layer: follow others, browse public profiles, compare collections.
- **MangaCollector synergy** — cross-link the manga you read with the figures you collect, via the series' shared MAL id (over an admin-curated server allow-list).
- **Notifications** — events fire from the backend, dispatched per channel based on user routing.

## Your collection

- [Catalogue & collection](catalogue.md) — browse, add (incl. **barcode scan**), filter, mark conditions, **bulk edit**, attach **receipts**
- [Vitrines](vitrines.md) — your collection arranged into glass display cabinets, with diorama staging
- [Photos & 360° scans](photos.md) — multi-upload, **edit in place**, covers, lightbox, turntable + gsplat

## Value & money

- [La Cote](cote.md) — collection value vs what you paid; **auto-priced from the market** with sparklines + evolution charts
- [Money & currencies](currency.md) — one display currency, ≈ conversion with originals on hover, **rates frozen at purchase**

## Acquiring

- [Wishlist](wishlist.md) — target prices, **price alerts**, owned≠wishlist rule, multi-source bulk import, **shareable gift list**
- [URL import](url-import.md) — paste an orzgk (or proxy-backed store) URL to import metadata, version picker included
- [Pre-orders](preorders.md) — release dates, slip history, **deposits**, **cancellations with refund tracking**, **delivery ETAs**

## Community

- [Collectors](social.md) — follow, discover, compare (opt-in public profile)
- [MangaCollector synergy](manga.md) — cross-link with MangaCollector via the series' MAL id

## Around the app

- [Achievements, stats & insights](achievements-stats.md) — milestone seals, next palier, year-in-review, the full stats page
- [Notifications](notifications.md) — 6 channels + per-event routing, price alerts included
- [Data export](exports.md) — CSV / JSON per dataset + full backup
- [NSFW handling](nsfw.md) — show / blur / hide
- [PWA & offline](pwa.md) — installable, mobile bottom bar, NetworkFirst on catalog reads
- [Administration](admin.md) — instance policies, market-price cron, job history, workers

# Catalogue & collection

## Catalogue

The **catalogue** (`/browse`) is the shared figure database. Every user sees the same figures, manufacturers, series, and characters. New figures can be added either:

- **Manually** — name, type, manufacturer, scale, JAN/EAN barcode, release date, MSRP, NSFW flag, official image URL.
- **From MFC** — paste a MyFigureCollection URL and the scraper imports the metadata. Rate-limited (1 req/s per user), cached 24 h in Postgres.
- **From AniList** — for series + character cross-references.

!!! note "Manual entry is always available"
    Per hard project rule, **manual entry must always work alongside any external source**. If MFC is down or the URL is unknown, you can still create the figure from scratch.

Figures support kanji type tags (statue, nendoroid, figma, prize, trading, statue, plamo, bishoujo, dakimakura, …) and a primary photo selected from the catalogue-side photo library.

## Collection (`/collection`)

Your **collection** is the per-user layer on top: each row in `owned_items` references a `figure_id` and adds:

- `condition` — MIB sealed, opened box, displayed, loose, damaged
- `price_amount` + `price_currency` — what you actually paid
- `shipping_amount` — separate so the figurine cost stays comparable to MSRP
- `store`, `purchase_date`, `location`, `notes`
- `cover_photo_id` / `cover_scan_id` — your pinned cover (overrides the catalogue primary)

### Filters

The collection page exposes filter tiles per condition kanji (封 sealed, 開 opened, 飾 displayed, 裸 loose, 痍 damaged) with live counts.

### Archived items

Pieces that came from a cancelled preorder with a partial refund are **archived** rather than deleted, so the loss can be remembered. They're hidden from the default view, surfaced via a "Voir aussi les pré-commandes annulées" toggle, and stamped with a laque-red "Annulée" badge that out-priorities the regular preorder badge.

See [Pre-orders](preorders.md#cancellations) for the full cancellation flow.

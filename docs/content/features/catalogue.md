# Catalogue & collection

## Catalogue

The **catalogue** (`/browse`) is the shared figure database. Every user sees the same figures, manufacturers, series, and characters. New figures can be added either:

- **Manually** — name, type, manufacturer, scale, JAN/EAN barcode, release date, MSRP, NSFW flag, official image URL.
- **From a product URL** — paste an **orzgk** link (native scraper, with a version / payment picker), or any other store through the optional [external proxy](url-import.md). Lookups are cached 24 h in Postgres.
- **From MFC** — MyFigureCollection blocks direct scraping (Cloudflare), so you paste the item **page HTML** and the backend parses it.
- **From AniList** — for series + character cross-references.
- **By barcode scan** — point your phone at the box's **JAN / EAN / UPC** barcode (see below).

!!! note "Manual entry is always available"
    Per hard project rule, **manual entry must always work alongside any external source**. If MFC is down or the URL is unknown, you can still create the figure from scratch.

Figures support kanji type tags (statue, nendoroid, figma, prize, trading, statue, plamo, bishoujo, dakimakura, …) and a primary photo selected from the catalogue-side photo library.

### Barcode scan

The browse search bar carries a **⌗ scan** button. It opens the device camera and reads **JAN / EAN-13 / EAN-8 / UPC** barcodes with the browser's native `BarcodeDetector` — no extra library, no CDN, no WASM. A scanned code hits `GET /figures/by-jan`:

- a **catalogue hit** opens that figure;
- an **unknown barcode** jumps straight to the add page with the JAN pre-filled, ready for manual entry or a URL import.

Where the camera or the API isn't available (notably iOS Safari), the dialog falls back to a manual barcode field — the lookup is identical.

### Wishlist & owned markers

Each catalogue card carries a **single** corner marker reflecting your
relationship to that figure, in priority order: a **pre-order badge**, an
**owned seal** (✓, gold), or a **wished heart** (♥, laque). A card never stacks
two. See [Wishlist](wishlist.md) for the owned ≠ wishlist rule and bulk import.

## Collection (`/collection`)

Your **collection** is the per-user layer on top: each row in `owned_items` references a `figure_id` and adds:

- `condition` — MIB sealed, opened box, displayed, loose, damaged
- `price_amount` + `price_currency` — what you actually paid
- `shipping_amount` — separate so the figurine cost stays comparable to MSRP
- `store`, `purchase_date`, `location`, `notes`
- `cover_photo_id` / `cover_scan_id` — your pinned cover (overrides the catalogue primary)

### Filters

The collection page exposes filter tiles per condition kanji (封 sealed, 開 opened, 飾 displayed, 裸 loose, 痍 damaged) with live counts.

### Bulk edit

For sweeping changes, the collection header has a **☑ Sélection multiple** toggle (set apart from the *Vitrines* / *La Cote* lenses). It turns each card into a checkbox and reveals a sticky action bar. Select any number of pieces (or *Tout*), then apply in one pass:

- **Ranger dans…** — move them to a vitrine / location,
- **Définir l'état…** — set the condition,
- **Archiver** — archive them,
- **Supprimer** — delete (behind a confirm).

### Proof-of-purchase documents

Each owned piece has a private **Justificatifs** section (証) for receipts, invoices, and customs slips — **PDF / JPEG / PNG / WebP, up to 10 MB** each. Unlike photos, documents are stored **as-is** (a PDF stays a PDF — no re-encoding), their magic bytes are sniffed server-side so the store can't be abused, and the serving proxy (`GET /api/documents/{id}`) is **owner-only and never public** (`Content-Disposition: inline`, `Cache-Control: private`).

### Archived items

Pieces that came from a cancelled preorder with a partial refund are **archived** rather than deleted, so the loss can be remembered. They're hidden from the default view, surfaced via a "Voir aussi les pré-commandes annulées" toggle, and stamped with a laque-red "Annulée" badge that out-priorities the regular preorder badge.

See [Pre-orders](preorders.md#cancellations) for the full cancellation flow.

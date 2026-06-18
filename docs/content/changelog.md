# What's new

The notable user-facing changes per minor version. Patch releases and the full
detail live in the [git history](https://github.com/Dim145/FigureCollector/commits/main).

## 0.30 — search by look

- **"Apparence" search** — a third catalogue search mode (beside *Keywords* and
  *Meaning*): describe how a figure *looks* — pose, hair colour, outfit, "a
  white-haired elf" — and find it by appearance. Powered by multilingual SigLIP2
  (text→image, fully on-device): the worker embeds catalogue images, the browser
  embeds your description, both in one shared space. Works across languages and
  honours your NSFW preference like the rest of the catalogue.
- **Match % + a tunable floor** — each result carries a match score, with an
  admin **Pertinence minimale** floor to trim the weak tail.
- **Admin opt-in, off by default** — enable it in **Réglages**, then **Indexer
  les images (apparence)** to build the index; the embed worker keeps it
  current. The SigLIP text model (~283 MB) downloads only the first time you
  open "Apparence", then stays cached. *Meaning* search (e5) remains a separate,
  lighter option — the two are complementary.

## 0.29 — search by meaning

- **Semantic ("Sens") search** — the catalogue search bar gains a *Meaning* mode
  beside *Keywords*: describe a figure in your own words — even in another
  language — and find it by sense, not just exact text. Cross-lingual matches
  that keyword search misses now work (e.g. *mariée* surfaces a *Wedding*
  figure). Runs fully on-device (multilingual-e5-small), like photo search — your
  query never leaves the browser, and it honours your NSFW preference like the
  rest of the catalogue.
- **Match % + a tunable floor** — each result carries a match-%, strongest
  first. An admin sets the minimum a result must reach in **Réglages →
  Recherche par le sens → Pertinence minimale** to trim the weak tail.
- **Admin opt-in, off by default** — turn it on in **Réglages**, then **Indexer
  les textes** to build the index; the embed worker keeps it current as figures
  change.

## 0.28 — browse by vibe

- **Ambiances** — an optional way to browse the catalogue by visual *vibe*
  rather than by category: the collection is grouped into families of
  similar-looking figures (same on-device fingerprint as photo search). A toggle
  on the catalogue switches between the flat grid and the vibe gallery; open a
  vibe to see its members. Each tile shows a mosaic, its dominant type, and a
  count.
- **Admin opt-in, off by default** — vibes only pay off on a large, varied
  catalogue, so an admin turns them on in **Réglages** once the collection is
  big enough. The setting carries a one-line description, a relevance estimate
  (≈ 50 varied figures) with the live catalogue count, and a "?" explaining what
  a vibe is.

## 0.27 — recommendations & catalogue hygiene

- **Recommandé pour toi** — your Collection page now ends with a personalised
  rail: catalogue figures whose look is closest to what you own (DINOv2),
  excluding anything you already own or wishlist. Shows four at a time with a
  match-% on each; "Passer" skips one and reveals the next, and the rail bows
  out once you've seen them all.
- **A quality bar you control** — both this rail and the figure-page "figurines
  proches" only surface genuinely-close matches (default **75 %**). Tune the
  floor in **Admin → Réglages → Seuil de similarité**.
- **Catalogue duplicate detection** (admin) — a "Doublons potentiels" panel on
  the Tasks page flags figure pairs that look near-identical (the same piece
  listed twice, or a re-release), side by side, so you can merge or remove.

## 0.26 — neighbours & a release calendar

- **Figurines proches** — every figure page now ends with a "similar figures"
  rail: its closest visual neighbours from the catalogue, found via the same
  on-device DINOv2 fingerprints that power photo search. Honours your NSFW
  preference (hidden, blurred, or shown) like the rest of the catalogue.
- **Subscribe to your pre-orders** — a private iCal feed of your release dates,
  one tap from the Pre-orders page. Add it to Google / Apple / Outlook calendar
  and your upcoming figures appear as all-day events; the link is secret and can
  be regenerated if it ever leaks.

## 0.25 — find it by photo

- **Search the catalog by photo** — photograph a figure and FigureCollector
  finds the matching catalog entry. The visual fingerprint is computed **in your
  browser** (DINOv2-small), so the photo never leaves your device — only an
  anonymous 384-number signature travels to find the piece. Reach it from its
  own page or the **camera button in the catalogue search bar** (snap a photo →
  results, no detour).
  → [Photo search](features/visual-search.md)
- **Optional web fallback** — when nothing in the catalog matches, you can
  choose to extend the search to the web (Google Vision). This is **opt-in and
  explicit**: it's the one path where the photo is sent off-device, and it
  returns identification leads (a best guess, recognised terms, matching pages)
  to help you add the piece by hand. Admin-configured, off by default.
  → [Photo search](features/visual-search.md#web-fallback)
- **Admin**: a single toggle enables photo search; a CPU-only worker builds the
  catalog index — your gsplat worker does it by default, or run the standalone
  `embed-worker` on a GPU-less host — and new figures/photos are indexed
  automatically. Indexing progress (done/queued/failed, worker status, re-index
  + retry-failed) shows live on **Admin → Tasks**.
  → [Photo search](features/visual-search.md#admin)

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

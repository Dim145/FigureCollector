# Features

FigureCollector is built around a small set of overlapping mental models:

- **Catalogue** — the shared figure dataset (everyone sees the same figures, manufacturers, series).
- **Collection** — *your* layer on top: prices, condition, store, notes — arranged into cabinets ([Vitrines](vitrines.md)) and valued in [La Cote](cote.md).
- **Wishlist** — figures you covet but don't own yet (mutually exclusive with the collection).
- **Pre-order lifecycle** — preorder → shipped → delivered → received, with deposit & refund accounting along the way.
- **Photos** — both catalogue-side (shared) and personal (yours).
- **Collectors** — an opt-in social layer: follow others, browse public profiles, compare collections.
- **Notifications** — events fire from the backend, dispatched per channel based on user routing.

Each feature has its own page below:

- [Catalogue & collection](catalogue.md) — browse, add, filter, mark conditions
- [Vitrines](vitrines.md) — your collection arranged into glass display cabinets
- [La Cote](cote.md) — collection value vs what you paid, per currency
- [Wishlist](wishlist.md) — target prices, owned≠wishlist rule, bulk import from orzgk
- [URL import](url-import.md) — paste an orzgk (or proxy-backed store) URL to import metadata
- [Pre-orders](preorders.md) — release dates, slip history, **deposits**, **cancellations with refund tracking**, **delivery ETAs**
- [Photos & 360° scans](photos.md) — multi-upload, **edit in place**, covers, lightbox, turntable
- [Collectors](social.md) — follow, discover, compare (opt-in public profile)
- [Achievements, stats & insights](achievements-stats.md) — milestone seals, next palier, year-in-review, deeper charts
- [Data export](exports.md) — CSV / JSON per dataset + full backup
- [Notifications](notifications.md) — channels (in-app, email, ntfy, webhook, Apprise, Web Push) + per-event routing
- [NSFW handling](nsfw.md) — show / blur / hide
- [PWA & offline](pwa.md) — installable, NetworkFirst on catalog reads

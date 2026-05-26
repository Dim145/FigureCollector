# Features

FigureCollector is built around a small set of overlapping mental models:

- **Catalogue** — the shared figure dataset (everyone sees the same figures, manufacturers, series).
- **Collection** — *your* layer on top: prices, condition, store, notes.
- **Pre-order lifecycle** — preorder → shipped → delivered → received, with deposit & refund accounting along the way.
- **Photos** — both catalogue-side (shared) and personal (yours).
- **Notifications** — events fire from the backend, dispatched per channel based on user routing.

Each feature has its own page below:

- [Catalogue & collection](catalogue.md) — browse, add, filter, mark conditions
- [Pre-orders](preorders.md) — release dates, slip history, **deposits**, **cancellations with refund tracking**, **delivery ETAs**
- [Photos & 360° scans](photos.md) — multi-upload, covers, lightbox, turntable
- [Notifications](notifications.md) — channels (in-app, email, ntfy, webhook, Apprise, Web Push) + per-event routing
- [Achievements & stats](achievements-stats.md) — milestone seals, year-in-review, losses on cancellations
- [NSFW handling](nsfw.md) — show / blur / hide
- [PWA & offline](pwa.md) — installable, NetworkFirst on catalog reads

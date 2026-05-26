# FigureCollector

<span class="kanji" style="font-size: 4rem; float: right; line-height: 0.9; margin-left: 1rem;">像</span>

> **Catalogue your shelf — figure by figure.**

**FigureCollector** is a self-hosted Progressive Web App for figurine collectors. It tracks every piece you own (or want), records purchase prices and stores, follows pre-orders whose release dates keep slipping, surfaces upcoming deliveries, and discovers figures across series — all behind a hardened Rust backend running in a `FROM scratch` container.

It is the figurine companion to [MangaCollector](https://github.com/Dim145/MangaCollector) (same author, same architecture).

---

## Why FigureCollector?

- **Self-hosted, no SaaS lock-in.** Your data stays on hardware you control.
- **Privacy-first.** No third-party trackers, no telemetry, no upload-to-cloud unless you wire your own S3.
- **Offline-first.** Installable PWA, works on a plane, syncs on reconnect.
- **Hardened.** The backend is a static binary in `FROM scratch`. The frontend nginx is distroless. Both run read-only, with `cap_drop ALL` and `no-new-privileges`. Zero OpenSSL in the dependency tree.

---

## At a glance

<div class="grid cards" markdown>

- :material-bookshelf:{ .lg .middle } **Catalogue + collection**

    ---
    A shared catalogue (figures, manufacturers, series, characters, sculptors) and your personal collection layered on top, with prices, stores, dates, and notes.

- :material-truck-delivery:{ .lg .middle } **Pre-orders with deposits & ETAs**

    ---
    Track deposits, balances, slipped release dates, and delivery countdowns. Get notified when the parcel is overdue.

- :material-bell-ring:{ .lg .middle } **Notifications**

    ---
    In-app + email + ntfy + webhook + Apprise + Web Push, with per-channel routing per event.

- :material-image-multiple:{ .lg .middle } **Photos & 360° scans**

    ---
    Multi-upload, fullscreen lightbox with pinch-zoom, per-user covers, optional 360° turntable scans.

- :material-shield-lock:{ .lg .middle } **Hardened by construction**

    ---
    `FROM scratch` Rust binary, distroless nginx, read-only filesystems, `cap_drop: ALL`. No OpenSSL anywhere.

- :material-chart-line:{ .lg .middle } **Year-in-review**

    ---
    Money spent, top manufacturer, top series, longest slip, losses on cancellations. Painted in gold and laque-red.

</div>

---

## Where to next?

- :material-rocket-launch: [**Getting started**](getting-started/index.md) — fire up the stack with Docker Compose.
- :material-puzzle: [**Features**](features/index.md) — what the app actually does.
- :material-server: [**Self-hosting**](self-hosting/index.md) — production deployment, hardening, backups.
- :material-source-branch: [**Architecture**](architecture/index.md) — stack, data model, security contract.

---

## License

[AGPL-3.0-or-later](https://www.gnu.org/licenses/agpl-3.0.en.html) — same as MangaCollector.

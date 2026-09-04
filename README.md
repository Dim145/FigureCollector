# FigureCollector

> **Catalogue your shelf — figure by figure.**

**FigureCollector** is a self-hosted PWA for figurine collectors: catalogue every piece you own (or want), log purchase prices + stores, track pre-orders with deposits and slipped release dates, get notified when a parcel is overdue, and discover figures across series — all behind a hardened Rust backend running in a `FROM scratch` container.

It works **offline-first**, is **installable on iOS / Android / Desktop**, and pairs with [MangaCollector](https://github.com/Dim145/MangaCollector) (same author, same architecture).

📚 **Full documentation:** <https://dim145.github.io/FigureCollector/>

---

## Highlights

- 📦 **Catalogue + collection** — every figure you own or want, with manufacturer / series / character / sculptor / scale / NSFW metadata.
- 📷 **Barcode scan** — point your camera at a JAN / EAN / UPC to open a catalogued figure or jump to adding it (native `BarcodeDetector`, manual fallback — no extra dependency).
- ☑️ **Bulk collection edit** — multi-select pieces to re-shelve, set condition, archive, or delete in one pass.
- 🧾 **Proof-of-purchase** — attach receipts / invoices / customs slips (PDF / JPG / PNG / WebP) to a piece, stored as-is behind an owner-only proxy.
- 🗄️ **Vitrines** — arrange your collection into glass display cabinets with drag-and-drop, plus a "where is…?" search.
- 💴 **La Cote, auto-priced** — what your collection is worth vs what you paid: an admin-scheduled sweep prices owned figures from the market (orzgk + proxy boutiques), historizes every change, and charts the evolution; your manual valuations always win.
- 💱 **One display currency** — buy in ¥, € and $, read everything in your currency (ECB rates, on by default, originals on hover). Costs keep their **purchase-time exchange rate**, so the plus-value never drifts with the market.
- ⭐ **Wishlist with price alerts** — target prices that notify you when the market dips below them, an owned≠wishlist rule with at-a-glance catalogue markers, **bulk import** (public orzgk wishlist · proxy-handled boutiques · MFC CSV), and a **shareable gift list** (public link, anonymous reservations hidden from you).
- 🛒 **Pre-orders with deposit tracking** — record the upfront acompte (OrzGK / AmiAmi style), see the balance left to pay, and get notified when delivery is overdue.
- ✂️ **Cancellations with refund accounting** — cancelled preorder + partial refund? The piece is auto-archived, the loss surfaces in the yearly recap.
- 📸 **Photo gallery** — multi-upload, **edit in place** (crop / filters / background removal), per-user covers, NSFW blurring, 360° turntable scans, fullscreen lightbox with pinch-zoom.
- 👥 **Collectors** — an opt-in public profile; follow other collectors, discover by collection size, and compare collections.
- 📊 **Insights & year-in-review** — spend over time, series completion, wishlist cost, next-milestone palier, and an annual recap with losses on cancellations.
- 🏆 **Achievements** — milestone seals (印) the user collects as their collection grows.
- 🤖 **MCP endpoint** — hand an AI assistant a scoped, per-user API key and let it read the catalogue and curate your collection over the [Model Context Protocol](https://modelcontextprotocol.io) (`/mcp`). Read-only by default, every call audited, and **no administrative reach — not even with an admin's key**.
- 💾 **Data export** — your collection / wishlist / pre-orders as CSV or JSON, plus a one-file backup.
- 🔔 **Notifications** — in-app + email + ntfy + webhook + Apprise + Web Push, with per-channel routing per event (release J-day, J-7, delivery today, delivery overdue, price below target, achievement unlocked, …).
- 🛠️ **Operator-friendly** — live admin settings (3D-creation policy, price-sweep cron), every scheduled job run historized with a manual re-trigger, worker fleet status.
- 🔒 **Hardened from the kernel up** — `FROM scratch` backend, distroless nginx, read-only filesystems, dropped capabilities, no shell, no OpenSSL anywhere.

---

## Stack

### Backend (`server/`)

- Rust 2024 (rustc ≥ 1.95), Axum 0.8, Tokio
- SeaORM + PostgreSQL 16
- Rustls with aws-lc-rs — **zero OpenSSL** anywhere in the dependency tree
- Static musl binary shipped in `FROM scratch`
- OpenID Connect (Google or generic IdP) **plus** local username/password (Argon2id)

### Frontend (`client/`)

- React 19 + Vite 8 + Tailwind v4
- TanStack Query (offline-first) + Dexie (IndexedDB)
- PWA via `vite-plugin-pwa` + Workbox (with `NetworkFirst` on catalog reads so mutations show up on the next navigation)
- **Distroless** nginx runtime (Chainguard) — no shell, no package manager, non-root user
- **Doubles as the reverse proxy**: this nginx serves the static PWA *and* proxies `/api/*` + `/api/ws` to the Rust backend. Only this container exposes a host port; the `server` container is internal-only. Single-port ingress = single attack surface.

### Storage

- Postgres 16 for the relational graph
- [Garage](https://git.deuxfleurs.fr/Deuxfleurs/garage) (Deuxfleurs) — S3-compatible distributed object store, lighter than MinIO and designed for federated self-hosting. Filesystem fallback when S3 isn't configured.

---

## Security contract

| Layer | Backend | Frontend | Docs |
|---|---|---|---|
| Base image | `FROM scratch` | `cgr.dev/chainguard/nginx` | `cgr.dev/chainguard/nginx` |
| User | `65532:65532` | `65532` | `65532` |
| Filesystem | `read_only: true` + tmpfs `/tmp` 16M (`noexec,nosuid,nodev`) | `read_only: true` + tmpfs `/tmp`, `/tmp/nginx`, `/var/cache/nginx` | same as frontend |
| Capabilities | `cap_drop: ALL` | `cap_drop: ALL` | `cap_drop: ALL` |
| Privilege escalation | `no-new-privileges:true` | `no-new-privileges:true` | `no-new-privileges:true` |
| Healthcheck | `--health` subcommand (no curl/wget) | upstream nginx | upstream nginx |

Other hardening:

- **TLS:** Rustls + aws-lc-rs end-to-end on the backend.
- **HTTP security headers:** strict CSP, COOP, CORP, Referrer-Policy, Permissions-Policy on the frontend (`client/nginx.conf`).
- **Image uploads:** magic-bytes mimetype validation, EXIF strip, size and dimension caps.
- **External scraping:** orzgk fetched server-side with an aggressive PG cache (24 h TTL) + identifiable `User-Agent`; MFC parsed from pasted page HTML (it blocks direct fetch behind Cloudflare).
- **Session-fixation defense:** session token rotation on login.
- **Rate limiting:** `tower_governor` on auth-sensitive routes.

---

## Repo layout

```
FigureCollector/
├── server/                # Rust backend (Cargo crate, scratch container)
│   ├── src/
│   ├── migrations/        # SeaORM SQL migrations
│   ├── Cargo.toml
│   └── Dockerfile
├── client/                # React + Vite PWA
│   ├── src/
│   ├── public/
│   ├── package.json
│   ├── vite.config.js
│   ├── nginx.conf
│   └── Dockerfile
├── docs/                  # All documentation under one roof
│   ├── content/           # MkDocs Material source (published to GH Pages)
│   ├── mkdocs.yml
│   ├── nginx.conf
│   ├── Dockerfile
│   └── design/             # per-feature visual-direction maquettes (HTML)
├── .github/workflows/
│   ├── release.yml        # GHCR image push on tag
│   └── docs.yml           # MkDocs → GitHub Pages
├── docker-compose.yml         # local development stack
├── docker-compose.prod.yml    # production stack (Traefik-fronted)
├── docker-compose.docs.yml    # optional: self-host the docs
└── README.md
```

---

## Quick start

### Local dev (hot reload)

Prerequisites: Docker (with BuildKit), Rust ≥ 1.95 (via rustup), Node 24 with corepack/pnpm.

```bash
# Spin up PostgreSQL (+ Garage) for local dev
docker compose up -d postgres garage

# Backend (terminal A)
cd server
cp .env.example .env
cargo run

# Frontend (terminal B)
cd client
corepack enable
pnpm install
pnpm dev
```

Open <http://localhost:5173>. The dev server proxies `/api/*` and `/api/ws` to the backend on `:3000`.

### Fully containerised dev

```bash
docker compose up --build
```

This builds both images (backend `FROM scratch`, frontend distroless) and runs them with the full hardening profile. Slower iteration but matches production exactly.

### Production deployment

```bash
# Pre-flight: create the Traefik edge network if it does not exist
docker network create traefik_edge

# Configure secrets
cp .env.example .env.prod        # then edit

# Bring up the stack
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d
```

Required env vars (no defaults): `POSTGRES_PASSWORD`, `FRONTEND_URL`, `WEB_DOMAIN`, `S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`. Everything else (OIDC providers, rate limiting, parcel tracking…) is optional — see the [environment-variables reference](https://dim145.github.io/FigureCollector/getting-started/env-vars/).

### Self-host the docs

```bash
docker compose -f docker-compose.docs.yml up -d
```

Then open <http://localhost:8000>. The container builds the MkDocs site at image build time, then serves it from a read-only nginx with the same hardening profile as the main frontend.

---

## Documentation

Detailed install / configuration / feature / API docs live at <https://dim145.github.io/FigureCollector/>.

Local browsing:

```bash
cd docs
pip install -r requirements.txt
mkdocs serve
# → open http://localhost:8000
```

---

## License

[MIT](LICENSE) — © 2026 Dimitri Dubois.

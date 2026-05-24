# FigureCollector

> **Catalogue your shelf — figure by figure.**

**FigureCollector** is a self-hosted web app and PWA for figurine collectors who want to track every piece they own (or want to own), log purchase prices and stores, surface what's missing, follow pre-orders whose release dates keep slipping, and discover figures across series — all behind a hardened Rust backend running in a `FROM scratch` container.

It works **offline-first**, is **installable on iOS / Android / Desktop**, and is the figurine companion to [MangaCollector](https://github.com/Dim145/MangaCollector).

---

## Status

🚧 **Phase 0 — Bootstrap.** Project skeleton, hardened container setup, no business code yet. Visual direction to be picked from [`docs/design/preview.html`](docs/design/preview.html).

---

## Stack

### Backend (`server/`)

- Rust 2024 (rustc ≥ 1.85), Axum 0.8, Tokio
- SeaORM + PostgreSQL 16 (Phase 1+)
- Rustls with aws-lc-rs — **zero OpenSSL** anywhere in the dependency tree (Phase 1+)
- Static musl binary shipped in `FROM scratch`
- OpenID Connect (Google or generic IdP) **plus** local username/password (Argon2id) — Phase 1+

### Frontend (`client/`)

- React 19 + Vite + Tailwind v4
- TanStack Query (offline-first) + Dexie (IndexedDB) + WebSocket cross-device sync (Phase 1+)
- PWA via `vite-plugin-pwa` + Workbox
- **Distroless** nginx runtime (Chainguard) — no shell, no package manager, non-root user
- **Doubles as the reverse proxy**: this nginx serves the static PWA *and* proxies `/api/*` + `/api/ws` to the Rust backend. Only this container exposes a host port; the `server` container is internal-only. Single-port ingress = single attack surface.

---

## Security contract

| Layer | Backend | Frontend |
|---|---|---|
| Base image | `FROM scratch` (no shell, libc, package manager) | `cgr.dev/chainguard/nginx` (distroless) |
| User | `65532:65532` | `65532` |
| Filesystem | `read_only: true` + tmpfs `/tmp` 16M (`noexec,nosuid,nodev`) | `read_only: true` + tmpfs `/tmp`, `/tmp/nginx`, `/var/cache/nginx` |
| Capabilities | `cap_drop: ALL` | `cap_drop: ALL` |
| Privilege escalation | `no-new-privileges:true` | `no-new-privileges:true` |
| Healthcheck | `--health` subcommand (no curl/wget) | upstream nginx |

Other hardening (rolled out as features land):

- **TLS:** Rustls + aws-lc-rs end-to-end on the backend.
- **HTTP security headers:** strict CSP, COOP, CORP, Referrer-Policy, Permissions-Policy on the frontend (already configured in `client/nginx.conf`).
- **Image uploads:** magic-bytes mimetype validation, EXIF strip, size and dimension caps (Phase 2+).
- **MFC scraping:** rate-limited (1 req/s per user), aggressive PG cache (24 h TTL), identifiable `User-Agent`.
- **Session-fixation defense:** session token rotation on login (Phase 1+).
- **Rate limiting:** `tower_governor` on auth-sensitive routes (Phase 1+).

---

## Repo layout

```
FigureCollector/
├── server/                # Rust backend (Cargo crate, scratch container)
│   ├── src/main.rs
│   ├── Cargo.toml
│   ├── Dockerfile
│   ├── migrations/        # SeaORM/sqlx migrations (Phase 1+)
│   └── .env.example
├── client/                # React + Vite PWA
│   ├── src/
│   ├── public/
│   ├── package.json
│   ├── vite.config.js
│   ├── nginx.conf
│   └── Dockerfile
├── docs/
│   └── design/
│       └── preview.html   # 3 visual directions to choose from
├── docker-compose.yml         # local development stack
├── docker-compose.prod.yml    # production stack (Traefik-fronted)
└── README.md
```

---

## Local development

Prerequisites: Docker (with BuildKit), Rust ≥ 1.85 (via rustup), Node 24 with corepack/pnpm.

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

#### Garage one-time init

[Garage](https://git.deuxfleurs.fr/Deuxfleurs/garage) is an S3-compatible distributed object store from Deuxfleurs — lighter than MinIO and designed for federated self-hosting. After the first `docker compose up garage`, run:

```bash
# Wait until Garage announces its node ID, then capture it
NODE=$(docker compose exec garage /garage status \
        | awk '/^[a-f0-9]{16}/ {print $1; exit}')

# Single-node layout (1 GB usable, zone "dc1")
docker compose exec garage /garage layout assign "$NODE" -z dc1 -c 1G
docker compose exec garage /garage layout apply --version 1

# Create the bucket the backend will use
docker compose exec garage /garage bucket create figurecollector

# Mint an access key, then grant it RW on the bucket
docker compose exec garage /garage key create local-dev
docker compose exec garage /garage bucket allow figurecollector --read --write --key local-dev
```

The `key create` step prints an `Access Key ID` and `Secret Access Key` — paste them into `server/.env` under `S3_ACCESS_KEY` and `S3_SECRET_KEY`. Region stays `garage`, endpoint `http://garage:3902`, path-style required.

### Fully containerised dev

```bash
docker compose up --build
```

This builds both images (backend `FROM scratch`, frontend distroless) and runs them with the full hardening profile. Slower iteration but matches production exactly.

---

## Production deployment

```bash
# Pre-flight: create the Traefik edge network if it does not exist
docker network create traefik_edge

# Configure secrets
cp .env.example .env.prod        # then edit

# Bring up the stack
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d
```

Required env vars (no defaults): `POSTGRES_PASSWORD`, `FRONTEND_URL`, `SESSION_SECRET`, `AUTH_CLIENT_ID`, `AUTH_CLIENT_SECRET`, `AUTH_REDIRECT_URI`, `API_DOMAIN`, `WEB_DOMAIN`.

---

## Roadmap

- **Phase 0 — Bootstrap** *(you are here)*
- **Phase 1 — Auth + plumbing.** OIDC Google + generic + local (Argon2id), sessions, WebSocket sync, i18n FR/EN, rate-limiting.
- **Phase 2 — Figure model + ingestion.** PG schema (series, characters, manufacturers, sculptors, figures, owned_items, wishlist, preorders), MFC scraper, AniList integration, manual entry, multi-photo uploads.
- **Phase 3 — UI collection.** Dashboard, ledger/vitrine views, search & filters, bulk actions.
- **Phase 4 — Pre-order tracking** *(flagship v1 feature)*. Date-slip history, calendar + ICS subscription, in-app notifications.
- **Phase 5 — Social.** Public profiles `/u/{slug}`, compare `/compare/{slug}`, activity feed, wishlist sharing.
- **Phase 6 — Polish.** Seals/achievements, command palette ⌘K, year-in-review.

---

## License

AGPL-3.0-or-later — same as MangaCollector.

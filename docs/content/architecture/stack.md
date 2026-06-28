# Stack

## Backend (`server/`)

| Layer | Choice | Why |
|---|---|---|
| Language | **Rust 2024** (rustc ≥ 1.95) | Memory safety + statically linkable musl binary |
| HTTP | **Axum 0.8** | Tower middleware ecosystem, mature |
| Async runtime | **Tokio** | Default Rust async runtime |
| ORM | **SeaORM** (entity layer) + **sqlx** (hot-path queries) | Mature, type-safe, supports both query styles |
| Database | **PostgreSQL 16** | Mature, well-understood, JSON columns for activity payloads |
| TLS | **Rustls + aws-lc-rs** | Audited crypto core (BoringSSL fork), zero OpenSSL |
| Sessions | **tower-sessions** + sqlx store | Cookie sessions with server-side persistence |
| Auth | **OIDC** (`openidconnect`) + **Argon2id** (`argon2`) for local | Standard OIDC flows; password hashing via the modern Argon2id |
| Image processing | **image** crate | Magic-bytes mimetype validation, dimension caps |
| Notifications | **lettre** (email) + **reqwest** (ntfy/webhook) + **web-push-native** (Web Push) | Minimal viable surfaces |
| Migrations | **sea-orm-migration** wrapping raw SQL | Migrations live as `.sql` files; Rust wrappers `include_str!` them |
| Container | `FROM scratch` (no shell, no libc, no package manager) | Maximum attack-surface reduction |

## Frontend (`client/`)

| Layer | Choice | Why |
|---|---|---|
| UI library | **React 19** | Familiar, large ecosystem |
| Build | **Vite 8** (Rolldown) | Fast HMR, modern bundler |
| Styling | **Tailwind v4** | Utility-first, easy theming via CSS vars |
| Data fetching | **TanStack Query 5** | Server state cache, optimistic updates, invalidation |
| Local DB | **Dexie** (IndexedDB) | Offline persistence for things TanStack doesn't cover |
| PWA | **vite-plugin-pwa** + **Workbox** | Service worker generation, runtime caching |
| Routing | **react-router 6** | Standard |
| Image editing | **filerobot-image-editor** (lazy) | Crop, rotate, filters before upload |
| BG removal | **@imgly/background-removal** + ONNX Runtime (lazy) | Local AI background removal |
| 360° viewer | **gsplat** | Gaussian splat rendering |
| Container | `cgr.dev/chainguard/nginx` (distroless) | No shell, non-root, runs alongside the backend |

## Storage

| Layer | Choice | Why |
|---|---|---|
| Object store | **Garage** (Deuxfleurs) | Distributed S3-compatible, designed for federated self-hosting; filesystem fallback when no S3 |
| Photo CDN | None — backend serves photos through Postgres ACL | Photos are private by default; no direct bucket exposure |

## Documentation

| Layer | Choice | Why |
|---|---|---|
| Generator | **MkDocs Material** | Markdown-first, mature theming, low maintenance |
| Build base | `cgr.dev/chainguard/python:latest-dev` | Distroless Python with the dev tools needed by pip |
| Runtime base | `cgr.dev/chainguard/nginx` | Same hardening as the frontend |

## CI / release

| Layer | Choice |
|---|---|
| Tests | `.github/workflows/ci.yml` — three jobs: **client** (Vitest unit tests + lint + build), **server** (`cargo test` — unit + `#[sqlx::test]` integration against an ephemeral pgvector DB), **e2e** (Playwright smoke flows against an ephemeral Docker stack). See [Running tests](../getting-started/local-dev.md#running-tests) |
| Release | GitHub Actions (`.github/workflows/release.yml`) — builds + pushes to GHCR on tags |
| Docs deploy | `.github/workflows/docs.yml` — builds MkDocs, publishes to GitHub Pages on push to `main` |
| Image registry | **ghcr.io/dim145/figurecollector-{server,client,docs}** |
| Code quality | `pnpm lint` (eslint + react-hooks 7), `cargo clippy --workspace`, CodeQL SAST (advanced setup in `.github/workflows/codeql.yml`) |

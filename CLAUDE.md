# FigureCollector — Claude working notes

This is **Phase 0 (Bootstrap)**. The project mirrors the architecture of
[MangaCollector](https://github.com/Dim145/MangaCollector) (same author),
adapted for the figurine domain (multi-photos per item, JAN/EAN barcodes,
pre-order date-slip tracking, scale/material/sculptor attributes).

## Stack (authoritative)

| Layer | Choice |
|---|---|
| Backend | Rust 2024 (≥1.85), Axum 0.8, SeaORM, PostgreSQL 16, Rustls (aws-lc-rs) — **zero OpenSSL** |
| Frontend | React 19, Vite, Tailwind v4, TanStack Query, Dexie, `vite-plugin-pwa`, **pnpm exclusively** |
| Auth | OIDC (Google + generic) **plus** local username/password (Argon2id) |
| Storage | S3 / Garage ([Deuxfleurs](https://git.deuxfleurs.fr/Deuxfleurs/garage)) + filesystem fallback |
| Containers | Backend: `FROM scratch`. Frontend: `cgr.dev/chainguard/nginx` (distroless). |
| I18n | FR + EN initially |

## Hard rules

- Never introduce OpenSSL — use Rustls + aws-lc-rs everywhere (reqwest, sea-orm, aws-sdk-s3).
- Container hardening is non-negotiable: `read_only: true`, `cap_drop: ALL`,
  `no-new-privileges:true`, tmpfs `noexec,nosuid,nodev`, non-root uid 65532.
  When adding a runtime feature, check it still works under those constraints.
- Backend container has no shell and no HTTP client by default — the Docker
  HEALTHCHECK uses the `--health` subcommand of the binary itself.
- pnpm exclusively on the frontend; never run `npm install`.
- Strict CSP in `client/nginx.conf` — when adding an external host (MFC CDN,
  AniList CDN, etc.) extend `img-src` / `connect-src` explicitly.
- Manual entry must always be possible alongside any external metadata source
  (MFC scraper, AniList). The user explicitly required this.

## Conventions

- Indentation: 4 spaces for Rust/TOML, 2 spaces for JS/JSX/CSS/HTML/YAML.
- Commit messages: present tense, short subject (`add foo`, `fix bar`).
- Migrations live in `server/migrations/` (Phase 1+).
- Frontend imports: relative paths or `@/` alias (configured in `jsconfig.json`).

## Where to look

- Architectural decisions and rationale: `README.md` + the user's memory files
  (`project_figurecollector_scope`, `reference_mangacollector_template`).
- Visual direction options: `docs/design/preview.html` (Phase 0 deliverable).
- MangaCollector reference (template): <https://github.com/Dim145/MangaCollector>.

## Watch out

- MangaCollector's own `CLAUDE.md` is stale (still mentions a previous Node era).
  Trust its `README.md` and `server/Cargo.toml` instead.
- MFC has no official API — community proxies (tenji.moe) exist but are
  unreliable. Plan for scraping with aggressive caching and rate-limiting.

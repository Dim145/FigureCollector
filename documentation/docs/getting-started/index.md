# Getting started

There are three ways to run FigureCollector:

1. **[Local dev](local-dev.md)** — fastest iteration. Postgres + Garage in Docker, backend with `cargo run`, frontend with `pnpm dev`.
2. **[Fully containerised dev](local-dev.md#fully-containerised-dev)** — same images as production, slower rebuilds, matches the deploy environment exactly.
3. **[Production deployment](production.md)** — Traefik-fronted compose stack with TLS + secrets.

If you just want to *try* it on your laptop, jump to [local dev](local-dev.md).

If you want to *deploy* it for your collection long-term, read [production](production.md) and [hardening](../self-hosting/hardening.md).

---

## Prerequisites

| Tool | Minimum | Why |
|---|---|---|
| Docker (with BuildKit) | recent | All runtime services + container builds |
| Rust (`rustup`) | ≥ 1.95 | Backend dev mode |
| Node + pnpm (via corepack) | Node 24 / pnpm 9+ | Frontend dev mode |

Postgres, Garage (S3), the Rust backend image and the nginx frontend image are all produced from the repo — no external services required.

---

## First boot checklist

1. Clone the repo and `cd` into it.
2. Bring up Postgres + Garage: `docker compose up -d postgres garage`
3. Run the [Garage one-time init](local-dev.md#garage-one-time-init) to mint S3 credentials.
4. Configure `.env`: `cp server/.env.example server/.env` and paste your Garage keys.
5. Start the backend: `cd server && cargo run`
6. Start the frontend: `cd client && pnpm install && pnpm dev`
7. Open <http://localhost:5173> and sign up.

That's it. The catalogue is empty by default — start by adding a figure manually or pasting an MFC / AniList URL.

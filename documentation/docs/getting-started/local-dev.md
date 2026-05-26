# Local development

## Hot-reload setup

```bash
# Spin up PostgreSQL (+ Garage S3) for local dev
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

Open <http://localhost:5173>. The Vite dev server proxies `/api/*` and `/api/ws` to the Rust backend on `:3000`.

!!! tip "pnpm exclusively"
    FigureCollector is **pnpm-only**. Never run `npm install` — it would create a divergent `package-lock.json` that confuses the build.

---

## Garage one-time init

[Garage](https://git.deuxfleurs.fr/Deuxfleurs/garage) is an S3-compatible distributed object store from Deuxfleurs — lighter than MinIO and designed for federated self-hosting. After the first `docker compose up garage`:

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

!!! note "Filesystem fallback"
    If you don't want to bother with Garage in dev, leave the `S3_*` env vars unset and uploads will land on disk under `./data/uploads`. The backend auto-detects the absence of S3 credentials.

---

## Fully containerised dev

```bash
docker compose up --build
```

Builds both images (backend `FROM scratch`, frontend distroless) and runs them with the full hardening profile. Slower iteration but matches production exactly.

Useful when:

- You want to test the production CSP, security headers, and CSP nonce flow.
- You changed `server/Dockerfile` or `client/Dockerfile` and want to verify the build still produces a working scratch / distroless image.
- You're reproducing an issue that only shows up under the read-only filesystem.

---

## Running tests

```bash
# Backend
cd server
cargo test --workspace

# Frontend
cd client
pnpm lint
pnpm build      # production build, verifies CSP + chunking
```

Lint cleanliness is non-negotiable — the build pipeline rejects new warnings.

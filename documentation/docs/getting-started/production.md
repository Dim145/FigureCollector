# Production deployment

The production stack is Traefik-fronted: only Traefik exposes ports on the host, everything else lives on the `traefik_edge` Docker network.

## Pre-flight

```bash
# Edge network (once, if you don't already use Traefik)
docker network create traefik_edge

# Secrets — copy the template and edit
cp .env.example .env.prod
```

Required env vars (no defaults — refuse to boot if any are missing):

- `POSTGRES_PASSWORD`
- `SESSION_SECRET` (32+ random bytes, used for cookie signing)
- `AUTH_CLIENT_ID`, `AUTH_CLIENT_SECRET`, `AUTH_REDIRECT_URI` — your OIDC provider
- `FRONTEND_URL`, `API_DOMAIN`, `WEB_DOMAIN`

Optional (recommended):

- `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` — Garage / MinIO / S3
- `SMTP_*` — for email notifications
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` — for Web Push
- `MFC_PROXY_URL` — if you front MFC scraping through your own proxy

See [Environment variables](env-vars.md) for the full list.

---

## Bring up the stack

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d
```

Traefik picks up the labels from `client` and routes:

- `https://WEB_DOMAIN/` → the frontend nginx
- `https://API_DOMAIN/api/*` → the same nginx (proxied to the backend)

Only the `client` service binds to the host. `server` and `postgres` are internal-only, accessible only over the `internal_net` Docker network.

---

## First admin user

The first user to register gets the admin flag automatically. After that, admin promotion is manual via SQL or the admin panel.

```bash
docker compose exec postgres psql -U figurecollector -c \
  "UPDATE users SET is_admin = true WHERE username = 'your-name';"
```

---

## Upgrades

```bash
git pull
docker compose -f docker-compose.prod.yml pull        # if you use prebuilt images from GHCR
docker compose -f docker-compose.prod.yml up -d --build
```

Migrations run automatically at backend startup via SeaORM Migrator. They are idempotent — restarting the same version is a no-op.

!!! warning "Backups before upgrades"
    Always [back up](../self-hosting/backup.md) the Postgres volume + the Garage bucket before a major version upgrade. Migrations have only one direction in production.

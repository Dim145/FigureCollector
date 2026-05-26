# Environment variables

The backend refuses to start if any **required** variable is missing — fail-fast instead of running with a broken default.

## Required

| Variable | What |
|---|---|
| `DATABASE_URL` | Postgres connection string, e.g. `postgres://figurecollector:…@postgres:5432/figurecollector` |
| `SESSION_SECRET` | 32+ bytes (hex or base64), used to sign session cookies |
| `FRONTEND_URL` | Canonical URL of the SPA (used in OAuth redirects, push payloads) |
| `AUTH_CLIENT_ID`, `AUTH_CLIENT_SECRET` | OIDC client credentials |
| `AUTH_REDIRECT_URI` | OIDC redirect URI, must match what's registered with the IdP |
| `AUTH_ISSUER_URL` | OIDC issuer (e.g. `https://accounts.google.com`) |

## Optional — storage

If unset, uploads fall back to the local filesystem under `./data/uploads`.

| Variable | Default | What |
|---|---|---|
| `S3_ENDPOINT` | — | e.g. `http://garage:3902` |
| `S3_REGION` | `garage` | S3 region tag |
| `S3_BUCKET` | `figurecollector` | Bucket name |
| `S3_ACCESS_KEY`, `S3_SECRET_KEY` | — | Garage / S3 credentials |
| `S3_PATH_STYLE` | `true` | Path-style URLs (required by Garage) |

## Optional — notifications

| Variable | What |
|---|---|
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | Email channel |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Web Push channel (generate with the admin panel) |
| `NTFY_DEFAULT_URL` | Default ntfy server when the user doesn't override |

## Optional — external metadata

| Variable | What |
|---|---|
| `MFC_PROXY_URL` | HTTP proxy used for MFC scraping (rate-limited to 1 req/s) |
| `ANILIST_CLIENT_ID`, `ANILIST_CLIENT_SECRET` | AniList API |

## Optional — observability

| Variable | What |
|---|---|
| `RUST_LOG` | `info` by default. Set to `debug` for chatty logs. |
| `LOG_FORMAT` | `json` or `text`. Production defaults to `json`. |

---

## Where they go

- **Development**: `server/.env` (loaded by `dotenvy`).
- **Production**: `.env.prod` consumed by `docker-compose.prod.yml --env-file`. Never commit this file.
- **CI**: GitHub Actions secrets — `gh secret set NAME` from the repo root.

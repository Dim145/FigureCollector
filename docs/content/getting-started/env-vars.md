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
| `FIGURE_PROXY_URL` | Base URL of the boutique-scraping proxy (no trailing slash). When unset, the `/api/external/proxy/*` routes return `feature_disabled` and the SPA hides the proxy lookup UI. See [URL import](../features/url-import.md). |
| `FIGURE_PROXY_API_KEY` | Optional bearer token sent on every proxy call. |

## Optional — rate limiting

The built-in rate limiter (tower_governor) guards the auth routes
(`/api/auth/*`) — login / register / OIDC callbacks — keyed by client
IP. It does **not** touch the rest of the API.

| Variable | Default | What |
|---|---|---|
| `RATE_LIMIT_ENABLED` | `true` | Master switch. Set to `false`/`0`/`no`/`off` to remove the limiter entirely — do this when you front the app with your own limiter (Traefik, Cloudflare) or when the defaults are too tight for your OIDC bursts. |
| `AUTH_RATE_LIMIT_PER_SECOND` | `2` | Sustained requests/second allowed per IP on auth routes. |
| `AUTH_RATE_LIMIT_BURST` | `8` | Burst allowance on top of the sustained rate. |

!!! note "429 on the 360° viewer"
    The turntable viewer used to fire every frame request at once, which
    could trip an *upstream* limiter (your reverse proxy / host) — never
    the built-in one above, which is auth-only. The viewer now loads
    frames with bounded concurrency + per-frame retry, and surfaces a
    "retry" button if frames still fail, so a transient 429 no longer
    leaves a hole in the rotation.

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

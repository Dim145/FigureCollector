# Environment variables

Exactly one variable is **required** — the backend refuses to start without it.
Everything else has a sensible default or quietly disables its feature.
The authoritative source is `server/src/config.rs`.

## Required

| Variable | What |
|---|---|
| `DATABASE_URL` | Postgres connection string, e.g. `postgres://figurecollector:…@postgres:5432/figurecollector` |

!!! note "No session secret"
    Sessions are server-side rows in Postgres (`tower-sessions`), so there is
    no `SESSION_SECRET` to generate or rotate.

## Core

| Variable | Default | What |
|---|---|---|
| `FC_BIND_ADDR` | `0.0.0.0:3000` | HTTP listen address of the backend. |
| `FRONTEND_URL` | `http://localhost:5173` | Canonical public URL of the SPA — drives OIDC redirects and the session cookie's `Secure` flag (on for `https://`, off for plain-HTTP dev). |
| `FC_COOKIE_INSECURE` | derived from `FRONTEND_URL` | Force-disable the `Secure` cookie flag (only for odd plain-HTTP setups behind TLS-terminating proxies). |

## Authentication

Local username/password sign-in (Argon2id) is always available; OIDC providers
appear automatically once their credentials are set.

| Variable | Default | What |
|---|---|---|
| `ALLOW_LOCAL_SIGNUP` | `true` | Allow self-service account creation. Set `false` for an OIDC-only (or invite-by-admin) instance. |
| `OIDC_GOOGLE_CLIENT_ID` / `OIDC_GOOGLE_CLIENT_SECRET` | — | Enable the Google sign-in button. |
| `OIDC_GOOGLE_ISSUER_URL` | `https://accounts.google.com` | Rarely changed. |
| `OIDC_GOOGLE_DISPLAY_NAME` | `Google` | Button label. |
| `OIDC_GOOGLE_SCOPES` | `openid,email,profile` | Comma-separated. |
| `OIDC_GENERIC_CLIENT_ID` / `OIDC_GENERIC_CLIENT_SECRET` | — | Enable a generic OIDC provider (Authelia, Keycloak, Authentik, …). |
| `OIDC_GENERIC_ISSUER_URL` | — | **Required** when the generic provider is enabled. |
| `OIDC_GENERIC_DISPLAY_NAME` | `Single sign-on` | Button label. |
| `OIDC_GENERIC_SCOPES` | `openid,email,profile` | Comma-separated. |
| `OIDC_REDIRECT_BASE` | `FRONTEND_URL` | Base of the OIDC callback URL — override only when the API is reachable on a different origin than the SPA. |

## Storage

If unset, uploads fall back to the local filesystem under `./data/uploads`.

| Variable | Default | What |
|---|---|---|
| `S3_ENDPOINT` | — | e.g. `http://garage:3902` |
| `S3_REGION` | `garage` | S3 region tag |
| `S3_BUCKET` | `figurecollector` | Bucket name |
| `S3_ACCESS_KEY`, `S3_SECRET_KEY` | — | Garage / S3 credentials |
| `S3_FORCE_PATH_STYLE` | `true` | Path-style URLs (required by Garage) |

## External metadata

| Variable | What |
|---|---|
| `FIGURE_PROXY_URL` | Base URL of the boutique-scraping proxy (no trailing slash). When unset, the `/api/external/proxy/*` routes return `feature_disabled` and the SPA hides the proxy lookup UI. Also powers the [market-price sweep](../features/cote.md) for non-orzgk boutiques. See [URL import](../features/url-import.md). |
| `FIGURE_PROXY_API_KEY` | Optional bearer token sent on every proxy call. |

## Parcel tracking

Best-effort carrier lookups for shipped pre-orders — each key enables its
carrier, missing keys simply hide it.

| Variable | Carrier |
|---|---|
| `COLISSIMO_API_KEY` | La Poste / Colissimo |
| `DHL_API_KEY` | DHL |
| `UPS_CLIENT_ID`, `UPS_CLIENT_SECRET` | UPS (OAuth2) |

!!! note "Notifications are configured in the app, not here"
    SMTP credentials, the Web-Push VAPID keypair, and ntfy defaults are all
    managed by the admin **in the UI** (*Administration → Notifications*) and
    stored in the database — there are no `SMTP_*` / `VAPID_*` environment
    variables. See [Notifications](../features/notifications.md).

## Rate limiting

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

## Housekeeping & observability

| Variable | Default | What |
|---|---|---|
| `GSPLAT_KEEP_COMPLETED` | `5` | How many successful gsplat scans to keep **per figurine** — older ones (rows + blobs) are pruned by the `scan_cleanup` job. Floored at 1. |
| `RUST_LOG` | `info` | Set to `debug` for chatty logs. |

---

## Where they go

- **Development**: `server/.env` (loaded by `dotenvy`).
- **Production**: `.env.prod` consumed by `docker-compose.prod.yml --env-file`. Never commit this file.
- **CI**: GitHub Actions secrets — `gh secret set NAME` from the repo root.

Environment changes need a container restart — unlike the
[admin settings](../features/admin.md), which apply live.

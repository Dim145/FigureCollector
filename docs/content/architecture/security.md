# Security contract

A short reference of what FigureCollector guarantees, what it doesn't, and where to look for the implementation.

## What we guarantee

### Container surface

- **`FROM scratch` backend** — no shell, no libc, no package manager. Source: `server/Dockerfile`.
- **Distroless nginx** for both frontend and docs. Source: `client/Dockerfile`, `docs/Dockerfile`.
- **Read-only rootfs**, **`cap_drop: ALL`**, **`no-new-privileges: true`** on every service. Source: `docker-compose.yml`, `docker-compose.prod.yml`, `docker-compose.docs.yml`.
- **Non-root user** (`65532`) everywhere.
- **No OpenSSL** anywhere in the dependency tree. Verified per-PR with `cargo tree -i openssl-sys`. Source: `Cargo.toml` (cookbook of Rustls + aws-lc-rs alternatives).

### Network surface

- Only **one host port** exposed in production — the frontend nginx. Backend + Postgres + Garage are internal-only. Source: `docker-compose.prod.yml`.
- Strict CSP, COOP, CORP, Referrer-Policy, Permissions-Policy on the frontend nginx. Source: `client/nginx.conf`.
- **Rate limiting** on auth-sensitive routes via `tower_governor`. Source: `server/src/main.rs` middleware stack.

### Auth

- **OIDC** with PKCE (`openidconnect` crate).
- **Local accounts** with Argon2id (`argon2` crate), default parameters m=19456,t=2,p=1.
- **Session-fixation defense**: session token rotation on login.
- **CSRF**: same-site cookies + state token on OIDC redirect.

### Data handling

- **Photos** are private by default. Served through the backend with ownership checks; no direct bucket exposure.
- **EXIF strip** on every upload to remove location metadata.
- **Magic-bytes mimetype validation** rather than trusting the `Content-Type` header.
- **Size + dimension caps** on uploads.

### External fetches

- **MFC scraping**: rate-limited (1 req/s per user), aggressive 24 h Postgres cache, identifiable `User-Agent` so MFC ops can contact us if there's a problem.
- **AniList**: same rate-limit pattern.

## What we don't guarantee

- **End-to-end encryption.** The database and S3 are server-side; an attacker with database access could read everything. If you need at-rest encryption, configure it at the volume / filesystem level (LUKS, ZFS native encryption, …).
- **Offline cryptographic erase.** Deleting a user only marks rows + drops bucket objects asynchronously; a forensic recovery on the underlying disk could still surface deleted content.
- **Anonymity from the host operator.** A self-hosting admin (you) can see every row in the database. There is no "blind" mode.

## Where to look

| Concern | Source |
|---|---|
| Hardening posture | `docker-compose*.yml`, `*/Dockerfile`, `*/nginx.conf` |
| CSP + security headers | `client/nginx.conf`, `docs/nginx.conf` |
| Auth flows | `server/src/auth/`, `server/src/routes/auth.rs` |
| Rate limiting | `server/src/main.rs` (tower_governor) |
| Image upload validation | `server/src/domain/photo.rs` |
| Migrations + schema | `server/migrations/` (SQL), `server/src/migration/` (Rust wrappers) |
| Dependency policy | `server/Cargo.toml` (Rustls everywhere; no openssl-sys), `client/package.json` (pnpm-only) |

## Reporting a vulnerability

Open a GitHub issue marked **PRIVATE** via the security advisory feature, or email the maintainer. The repo has CodeQL configured (`.github/codeql.yml`) so common SAST findings get caught at PR time.

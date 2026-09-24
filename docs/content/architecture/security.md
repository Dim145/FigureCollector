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
- **Rate limiting** on auth-sensitive *and* anonymous gift-share routes via `tower_governor`. Source: `server/src/routes/mod.rs`.
- **WebSocket** upgrades validate the `Origin` header against the configured frontend URL (anti-CSWSH). Source: `server/src/routes/ws.rs`.

### Auth

- **OIDC** with PKCE (`openidconnect` crate).
- **Local accounts** with Argon2id (`argon2` crate), default parameters m=19456,t=2,p=1.
- **Session-fixation defense**: session id rotation on every login.
- **Cookies**: `HttpOnly`, `SameSite=Lax`, and `Secure` derived from the public scheme (on for any HTTPS deployment).
- **API keys** for the [MCP endpoint](../features/mcp.md): 256-bit random secrets, stored as SHA-256 and compared in constant time, behind a 64-bit public prefix that makes the lookup a single indexed query. Explicit scopes, no wildcard; revocation stamps rather than deletes. Source: `server/src/domain/api_key.rs`.
- **`/mcp` accepts no cookie** — bearer only, which is what keeps it CSRF-immune while sitting outside the `/api` guard. It validates `Host` (anti-DNS-rebinding) and `Origin`, and administrative reach is absent by construction rather than by scope: `patch_figure` is called with `as_admin: false` unconditionally. Source: `server/src/routes/mcp/`.
- **CSRF**: SameSite=Lax plus a Fetch-Metadata backstop that refuses cross-site state-changing requests; OIDC carries `state` + PKCE + nonce, and the login initiation itself refuses a cross-site navigation (login-CSRF guard). Source: `server/src/routes/mod.rs`, `server/src/routes/auth.rs`.

### Data handling

- **Photos** are private by default. Served through the backend with ownership checks; no direct bucket exposure.
- **EXIF strip** on every upload to remove location metadata.
- **Magic-bytes mimetype validation** rather than trusting the `Content-Type` header.
- **Size + dimension caps** on uploads, enforced by the decoder *before* it allocates (a decompression bomb is refused, not decoded).
- **Private documents** (invoices, receipts) are served owner-only with `X-Content-Type-Options: nosniff` and `Content-Security-Policy: sandbox; default-src 'none'`, so a PDF that carries script can't run it even when opened inline. Source: `server/src/routes/documents.rs`.
- **Scan storage keys are derived from the scan's id, never read from the row.** The splat workers update `scans` directly with their own database credentials, so `storage_prefix` and `result_key` are treated as untrusted: a scan's frames, model and source video are always read and deleted at `scans/{id}/…`, and only `scans/{id}/result.ply` is ever served as a model. Trusting those columns would let anything able to write them stream — or delete — another user's objects. Source: `server/src/domain/scan.rs`, `server/src/routes/scans.rs`, `server/src/services/scan_cleanup.rs`.

### External fetches

- **MFC scraping**: rate-limited (1 req/s per user), aggressive 24 h Postgres cache, identifiable `User-Agent` so MFC ops can contact us if there's a problem.
- **AniList**: same rate-limit pattern.
- **SSRF egress filter**: every outbound URL a user chooses — notification webhook / ntfy / Apprise, **web-push endpoints** (the browser supplies them, but a client can send anything) and MangaCollector servers — is scheme-allow-listed and its *resolved* IPs rejected when private / loopback / link-local / CGNAT / ULA / `0.0.0.0/8` / metadata, including IPv4 embedded in IPv6 (`::ffff:` mapped and NAT64 `64:ff9b::/96`). Those calls go out on a client whose **own connect-time DNS resolution** runs through the same denylist, which closes DNS rebinding (a name that resolves public at check time and private at connect time), and which follows no redirects at all. Source: `server/src/external/notify_channel.rs`, `server/src/main.rs`.
- **Shop URLs a user pastes** (orzgk product and wishlist pages) are pinned to the shop's host and **rebuilt** from path and query, so the caller can't choose the scheme, port or userinfo. The general HTTP client follows only **same-host** redirects, so a shop's 3xx can't pivot to an internal target. Any other shop URL is handed to the operator's scraping proxy rather than fetched by the server. Source: `server/src/external/orzgk/`, `server/src/services/price_cron.rs`.
- **MangaCollector server allow-list**: the instance a user links to is **not** free-form — it must be an **admin-approved origin** (a user submits → `pending` → admin approves / revokes). Submitting runs the SSRF guard *before* the origin is stored, and every cross-link fetch is gated on `status = 'approved'` over the same no-redirect client, so a `pending`/`revoked` server is never fetched. Revoking an origin notifies every linked user and disables their integration. Source: `server/src/domain/manga_servers.rs`, `server/src/routes/manga.rs`.

### Supply chain

- **Every GitHub Action is pinned to a full commit SHA**, with its release in a trailing comment (`@<sha> # v4.4.0`). A tag like `@v4` can be re-pointed by whoever controls the action, and `release.yml` publishes the images with `packages: write`. Dependabot proposes pin bumps weekly — for `github-actions` only. Source: `.github/workflows/`, `.github/dependabot.yml`.
- **Locked dependencies**: `Cargo.lock` is enforced with `--locked` in the release build, `pnpm-lock.yaml` with `--frozen-lockfile`. Security fixes are applied **surgically** (`cargo update -p <crate>`, pnpm `overrides`) rather than by broad updates, and verified with the release Docker build — a broad Cargo update moves sqlx past what pgvector 0.4.2 supports, which host `cargo check` does not catch.
- **Known, accepted advisories** are ones with no safe fix on a path the app doesn't exercise: `lopdf 0.39` / `lru` / `ttf-parser` via `printpdf` (write-only; untrusted PDFs are parsed with a patched `lopdf`), `quick-xml` via `rust-s3` (talks only to your own Garage; no newer `rust-s3` exists), `rsa` (reached only for JWT / OIDC signature *verification*, a public-key operation the Marvin timing attack doesn't apply to), `rkyv 0.7` (build-time only).

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
| Rate limiting | `server/src/routes/mod.rs` (tower_governor) |
| CSRF + egress filtering | `server/src/routes/mod.rs` (Fetch-Metadata), `server/src/external/notify_channel.rs` (SSRF) |
| Image upload validation | `server/src/domain/photo.rs` |
| Migrations + schema | `server/migrations/` (SQL), `server/src/migration/` (Rust wrappers) |
| Dependency policy | `server/Cargo.toml` (Rustls everywhere; no openssl-sys), `client/package.json` (pnpm-only, security `overrides`) |
| CI supply chain | `.github/workflows/` (SHA-pinned actions), `.github/dependabot.yml` |
| Scan storage layout | `server/src/domain/scan.rs` (`storage_prefix_for`) |

## Reporting a vulnerability

Open a GitHub issue marked **PRIVATE** via the security advisory feature, or email the maintainer. The repo runs CodeQL in advanced setup (`.github/workflows/codeql.yml`, Rust + JavaScript/TypeScript + Actions) so common SAST findings get caught at PR time.

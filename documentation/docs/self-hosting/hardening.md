# Container hardening

The non-negotiable rules — they apply to every service in the stack.

## The contract

| Layer | Backend | Frontend | Docs |
|---|---|---|---|
| Base image | `FROM scratch` | `cgr.dev/chainguard/nginx` | `cgr.dev/chainguard/nginx` |
| User | `65532:65532` | `65532` | `65532` |
| Filesystem | `read_only: true` + tmpfs `/tmp` 16M | `read_only: true` + tmpfs `/tmp`, `/tmp/nginx`, `/var/cache/nginx` | same as frontend |
| Capabilities | `cap_drop: ALL` | `cap_drop: ALL` | `cap_drop: ALL` |
| Privilege escalation | `no-new-privileges: true` | `no-new-privileges: true` | `no-new-privileges: true` |
| Healthcheck | `--health` subcommand (no `curl`/`wget` available) | upstream nginx | upstream nginx |
| Shell | None — `/bin/sh` does not exist | None | None |

## Why each rule matters

### `FROM scratch` (backend)

The backend is compiled to a statically-linked `musl` binary. Shipping it in `FROM scratch` means the container literally contains *one file*: the binary. No libc, no `/bin`, no package manager, no shell. **Attack surface is the binary itself, full stop.**

This dictates the rest of the contract:

- The healthcheck can't shell out to `curl` — there's no shell. The binary itself implements a `--health` subcommand that does a TCP socket open + HTTP GET against `127.0.0.1` and exits 0/1.
- Logs go to stdout/stderr (captured by the Docker daemon). No syslog dependency.
- Env vars are the only configuration surface. No config files in the image.

### Distroless nginx (frontend + docs)

`cgr.dev/chainguard/nginx` is Chainguard's distroless image — nginx + its required `.so` files + a non-root user, and nothing else. No `/bin/sh`, no `apk`, no `bash`. Same attack-surface principle as the backend.

The frontend nginx **doubles as the reverse proxy**: it serves the static PWA *and* proxies `/api/*` + `/api/ws` to the backend. Only this container exposes a host port; the `server` container is on an internal-only Docker network.

### `read_only: true` + tmpfs

The container's rootfs is mounted read-only. Anything that needs to write (nginx's `/tmp`, `/var/cache/nginx`, the backend's `/tmp`) gets a tmpfs mount with `noexec,nosuid,nodev`. This means:

- **No persistent attacker payload** on the rootfs.
- **No `wget malware.sh && chmod +x && ./malware.sh`** — `noexec` blocks it.
- Container compromise is bounded to the request lifetime.

### `cap_drop: ALL`

The container starts with zero Linux capabilities. nginx specifically doesn't need any — it binds to port 8080 (not 80, which would require CAP_NET_BIND_SERVICE) and runs as uid 65532. The Traefik upstream maps `:443` → the container's `:8080`.

### `no-new-privileges: true`

Even if a setuid binary existed inside the container (it doesn't), it couldn't elevate. Combined with `cap_drop: ALL`, this kills the most common privilege-escalation paths.

## Zero OpenSSL

A hard project rule: **no OpenSSL anywhere in the dependency tree**. Verified per-PR with `cargo tree -i openssl-sys` returning empty.

Why? OpenSSL has been the source of more catastrophic CVEs than every other crypto library combined (Heartbleed, FREAK, GOTOFAIL, …). Rustls + aws-lc-rs is the alternative — same crypto primitives (`aws-lc` is the audited fork of BoringSSL), pure Rust TLS state machine. Used by:

- The Rust backend (Axum + tower-sessions, etc.)
- `reqwest` (the MFC scraper's HTTP client)
- `sea-orm` (Postgres TLS)
- `aws-sdk-s3` (Garage)

Adding a dependency that pulls OpenSSL transitively is rejected at PR time.

## Verifying hardening

```bash
# Confirm zero OpenSSL
cd server
cargo tree -i openssl-sys
# → error: package ID specification `openssl-sys` did not match any packages

# Confirm scratch base
docker image inspect figurecollector-server:latest \
  --format '{{json .RootFS}}' \
  | jq '.Layers | length'
# → 1 (a single layer: the binary)

# Confirm read-only + cap_drop in a running container
docker inspect figurecollector-client-1 \
  --format '{{json .HostConfig}}' \
  | jq '{ReadonlyRootfs, CapDrop, SecurityOpt}'
```

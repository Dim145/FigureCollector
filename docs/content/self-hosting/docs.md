# Self-host the docs

The very documentation you're reading is also shipped as a hardened container. Run it alongside the app — useful in air-gapped deployments or when you want the docs at a stable URL under your own domain.

## Quick start

```bash
docker compose -f docker-compose.docs.yml up -d
```

Opens on <http://localhost:8000>. The compose file applies the same hardening profile as the main frontend:

- `read_only: true`
- `cap_drop: ALL`
- `no-new-privileges: true`
- tmpfs on `/tmp`, `/tmp/nginx`, `/var/cache/nginx` (all `noexec,nosuid,nodev`)
- Non-root user `65532`

## What's in the image?

Multi-stage build, both stages from Chainguard:

1. **Build** — `cgr.dev/chainguard/python:latest-dev` runs `pip install mkdocs-material` then `mkdocs build`, producing a `site/` directory of static HTML + CSS + JS.
2. **Runtime** — `cgr.dev/chainguard/nginx` copies `site/` into `/usr/share/nginx/html` and serves it on port 8080. No build tools in the final image.

## Production deployment

Put it behind your existing Traefik:

```yaml
# docker-compose.docs.yml — labels block (excerpt)
services:
  docs:
    image: ghcr.io/dim145/figurecollector-docs:latest
    labels:
      - traefik.enable=true
      - traefik.http.routers.docs.rule=Host(`docs.example.com`)
      - traefik.http.routers.docs.entrypoints=websecure
      - traefik.http.routers.docs.tls.certresolver=le
      - traefik.http.services.docs.loadbalancer.server.port=8080
    networks:
      - traefik_edge
    read_only: true
    tmpfs:
      - /tmp:size=8M,mode=1777,noexec,nosuid,nodev
      - /tmp/nginx:size=4M,mode=1777,noexec,nosuid,nodev
      - /var/cache/nginx:size=8M,mode=1777,noexec,nosuid,nodev
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL
```

## GitHub Pages

The same MkDocs build also publishes to GitHub Pages on every push to `main` via `.github/workflows/docs.yml`. The hosted URL is <https://dim145.github.io/FigureCollector/>.

This means three places the docs can live:

| Where | When |
|---|---|
| GitHub Pages | Public canonical reference, always reflects `main` |
| Self-hosted container | Behind your VPN, alongside your app, version-pinned to a release tag |
| Local `mkdocs serve` | While editing, `:8001` with hot reload |

All three serve the same Markdown source from `documentation/docs/`.

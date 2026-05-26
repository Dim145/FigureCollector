# =============================================================================
# FigureCollector documentation — multi-stage build
#
# Stage 1: Chainguard Python "dev" variant (includes pip + apk for the install)
#          runs `pip install mkdocs-material` then `mkdocs build`, producing a
#          static `site/` directory.
#
# Stage 2: Chainguard nginx (distroless — no shell, no package manager, runs
#          as uid 65532) serves `site/` on :8080. Same hardening posture as
#          the client container (see docker-compose.docs.yml).
#
# Pinning:
#   - We pin to `:latest` Chainguard images intentionally: Chainguard rebuilds
#     them daily with the latest CVE patches. The lock between builds is the
#     `requirements.txt` for the MkDocs site (deterministic).
#
# Build:
#   docker build -t figurecollector-docs:dev documentation/
# =============================================================================

# ───────────────────────────────────────────────────────────────────────────────
# Stage 1 — build the static site
# ───────────────────────────────────────────────────────────────────────────────
FROM cgr.dev/chainguard/python:latest-dev AS builder

WORKDIR /build

# Copy ONLY what `pip install` and `mkdocs build` need first so the layer
# caches survive content-only edits.
COPY requirements.txt ./
RUN pip install --no-cache-dir --user -r requirements.txt
ENV PATH="/home/nonroot/.local/bin:${PATH}"

# Now the actual docs sources.
COPY mkdocs.yml ./
COPY docs/ ./docs/

# Build into ./site/. `--strict` makes the build fail on any broken link or
# missing reference so CI catches them, not the users.
RUN mkdocs build --strict --site-dir site/

# ───────────────────────────────────────────────────────────────────────────────
# Stage 2 — distroless nginx runtime
# ───────────────────────────────────────────────────────────────────────────────
FROM cgr.dev/chainguard/nginx:latest

# Copy the built site into nginx's html root. Owner adjustment isn't needed:
# Chainguard's nginx image expects files owned by uid 65532, and our COPY
# preserves the builder's nonroot uid (65532) — they line up.
COPY --from=builder /build/site/ /usr/share/nginx/html/

# Replace the default nginx.conf with our hardened version (port 8080, no
# directory listing, gzip on text assets, basic security headers).
COPY nginx.conf /etc/nginx/nginx.conf

EXPOSE 8080

# Healthcheck via the compose file (curl-less, uses the same trick as the
# main client: nginx's own status). See docker-compose.docs.yml.

# syntax=docker/dockerfile:1.7

# -----------------------------------------------------------------------------
# Build stage
# -----------------------------------------------------------------------------
FROM node:24-alpine AS builder

WORKDIR /build

# Enable pnpm via corepack (shipped with Node 24+).
RUN corepack enable && corepack prepare pnpm@10.33.4 --activate

COPY package.json pnpm-lock.yaml* .npmrc ./
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile || pnpm install

# Self-hosted ML assets for visual search (ORT WASM + DINOv2-small weights,
# ~97 MB) are NOT in the build context (.dockerignore) — fetch them in their
# own layer so the model download is cached across source-only rebuilds. The
# prebuild hook re-runs this on `pnpm run build` but finds everything present
# and skips the download.
COPY scripts ./scripts
# Opt-out for throwaway builds (see docker-compose.e2e.yml): the ~660 MB of ONNX
# weights are pointless in an image whose only job is to answer smoke tests.
ARG SKIP_ML_ASSETS=0
ENV SKIP_ML_ASSETS=$SKIP_ML_ASSETS
RUN node scripts/fetch-ml-assets.mjs

COPY . ./
RUN pnpm run build

# -----------------------------------------------------------------------------
# Runtime stage — Chainguard distroless nginx (no shell, no package manager).
# Falls back to nginxinc/nginx-unprivileged:alpine if Chainguard isn't reachable.
# -----------------------------------------------------------------------------
FROM cgr.dev/chainguard/nginx:latest AS runtime

LABEL org.opencontainers.image.title="FigureCollector Client"
LABEL org.opencontainers.image.description="Hardened distroless nginx serving the FigureCollector PWA."
LABEL org.opencontainers.image.source="https://github.com/Dim145/FigureCollector"
LABEL org.opencontainers.image.licenses="AGPL-3.0-or-later"
LABEL security.distroless="true"
LABEL security.no-shell="true"
LABEL security.no-package-manager="true"
LABEL security.user="65532"
LABEL security.readonly-rootfs-expected="true"

COPY --from=builder /build/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/nginx.conf
COPY security-headers.conf /etc/nginx/security-headers.conf

EXPOSE 8080
USER 65532

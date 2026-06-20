# syntax=docker/dockerfile:1.7

# -----------------------------------------------------------------------------
# Build stage: rust:alpine is musl-native → `cargo build` produces a fully
# static binary by default (no `+crt-static` needed; that flag breaks proc-macro
# crates like clap_derive). The final scratch image carries no libc, no shell,
# and no package manager.
# -----------------------------------------------------------------------------
# NOTE: 1.95 pins us to the latest stable. 1.87+ is the floor (web-push-native's
# transitive `aes-keywrap` 0.9.0 uses `unsigned_is_multiple_of`), and several
# updated deps (image 0.25.10, time 0.3.47, serde_with 3.20, home 0.5.12) need
# 1.88+, so we move the whole tree to the current stable in one go.
FROM rust:1.95-alpine AS builder

# Tooling needed by aws-lc-rs (used by rustls via sqlx's tls-rustls-aws-lc-rs):
#   - musl-dev / build-base : C runtime + compiler for the FFI shim
#   - cmake / perl          : aws-lc-rs build system
#   - clang / clang-dev     : libclang for bindgen
#   - linux-headers         : misc kernel headers used by C deps
RUN apk add --no-cache \
    musl-dev \
    build-base \
    cmake \
    perl \
    clang \
    clang-dev \
    linux-headers

WORKDIR /build

# Cargo.lock is copied + `--locked` enforced below so release images are
# reproducible and a malicious patch release of any transitive crate can't be
# silently pulled into the next build. Keep server/Cargo.lock committed.
COPY Cargo.toml Cargo.lock ./
COPY src ./src
COPY migrations ./migrations
# Bundled fonts for the insurance-dossier separator pages (include_bytes! in
# services/dossier.rs reads these at compile time).
COPY assets ./assets

# BuildKit cache mounts persist the cargo registry and the target directory
# across rebuilds without bloating the final image.
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/usr/local/cargo/git \
    --mount=type=cache,target=/build/target \
    cargo build --release --locked && \
    cp /build/target/release/figurecollector-server /figurecollector-server

# -----------------------------------------------------------------------------
# Runtime stage: scratch — no shell, no libc, no package manager, no CVE surface.
# -----------------------------------------------------------------------------
FROM scratch AS runtime

LABEL org.opencontainers.image.title="FigureCollector Server"
LABEL org.opencontainers.image.description="Hardened Rust backend for FigureCollector — runs in FROM scratch with no libc, no shell, no package manager."
LABEL org.opencontainers.image.source="https://github.com/Dim145/FigureCollector"
LABEL org.opencontainers.image.licenses="AGPL-3.0-or-later"
LABEL org.opencontainers.image.base.name="scratch"
LABEL security.no-shell="true"
LABEL security.no-package-manager="true"
LABEL security.no-libc="true"
LABEL security.no-openssl="true"
LABEL security.user="65532:65532"
LABEL security.readonly-rootfs-expected="true"
LABEL security.healthcheck="self (--health subcommand, no curl/wget required)"

COPY --from=builder /figurecollector-server /figurecollector-server

USER 65532:65532
EXPOSE 3000

ENTRYPOINT ["/figurecollector-server"]

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD ["/figurecollector-server", "--health"]

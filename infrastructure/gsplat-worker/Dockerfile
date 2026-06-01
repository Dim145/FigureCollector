# syntax=docker/dockerfile:1.7
#
# Phase 5B — Gaussian Splatting training sidecar.
#
# Rebased on the official Nerfstudio image, which already ships the whole stack
# we need — **CUDA-built COLMAP 3.9.1**, nerfstudio + the ns-* CLIs, gsplat,
# tinycudann, hloc and ffmpeg — so we only layer the worker's runtime deps on
# top. Two wins over the old hand-rolled image:
#   * COLMAP is built WITH CUDA, so feature extraction + matching run on the GPU
#     **headless** — COLMAP auto-selects CUDA when there's no display, so no
#     Xvfb, no OpenGL, no software-GL-on-CPU fallback. (`COLMAP_USE_GPU=true`.)
#   * No more compiling torch / nerfstudio / gsplat here → fast rebuilds.
#
# Base CUDA 11.8 / Ubuntu 22.04, system python3.10, CUDA archs incl. 8.6 (your
# RTX 3060 Ti). The host NVIDIA driver already runs CUDA 12.x, so 11.8 is fine.
#
# Pin the base for reproducibility — override with
#   --build-arg NERFSTUDIO_IMAGE=ghcr.io/nerfstudio-project/nerfstudio:<tag>
# `latest` is the floating upstream tag; dromni/nerfstudio:<version> is a
# well-maintained alternative with explicit version tags.
ARG NERFSTUDIO_IMAGE=ghcr.io/nerfstudio-project/nerfstudio:latest
FROM ${NERFSTUDIO_IMAGE}

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    U2NET_HOME=/opt/u2net \
    # COLMAP here is Qt-linked; force Qt's offscreen platform so the CLI
    # initialises with no X server. CUDA SIFT needs no GL context, so this is
    # all it takes to run feature extraction on the GPU headlessly.
    QT_QPA_PLATFORM=offscreen

# Required worker runtime deps — lightweight, no clash with the base's pins.
RUN --mount=type=cache,target=/root/.cache/pip \
    python3 -m pip install \
      asyncpg==0.30.0 \
      "boto3==1.35.*" \
      "structlog==24.4.*"

# Optional: rembg for foreground masking (used only when ENABLE_MASKING=true).
# Isolated in its own NON-FATAL layer — it drags in a big dep tree (onnxruntime,
# scikit-image, …) that could clash with the base's pinned numpy/torch. If the
# build trips here it's skipped and the worker runs with masking disabled (it
# degrades gracefully); fix this line if you need masks.
RUN --mount=type=cache,target=/root/.cache/pip \
    python3 -m pip install "rembg==2.0.*" \
    || echo "WARN: rembg install failed — foreground masking will be unavailable"
RUN mkdir -p /opt/u2net && \
    python3 -c "from rembg import new_session; new_session()" 2>/dev/null || true && \
    chmod -R a+rX /opt/u2net

COPY worker.py /app/worker.py

# Drop privileges — matches the compose hardening (no-new-privileges:true).
RUN useradd -u 65532 -m worker && \
    mkdir -p /work && chown -R worker /work
USER 65532
WORKDIR /work

CMD ["python3", "/app/worker.py"]

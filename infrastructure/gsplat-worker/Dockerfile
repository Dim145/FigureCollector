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

# rembg for foreground masking (ENABLE_MASKING, default on). onnxruntime is its
# inference backend, which rembg 2.0.x moved OUT of the core deps into extras —
# so we MUST request the `[cpu]` extra; a bare `rembg` installs fine but then
# fails at import with "No module named 'onnxruntime'". CPU on purpose: the
# `[gpu]` extra (onnxruntime-gpu) would couple to the base image's CUDA/cuDNN and
# risk clashing with torch, and rembg isn't the bottleneck (training is).
# onnxruntime's only version floor is numpy>=1.21.6, which the base already
# satisfies, so this doesn't drag a numpy upgrade onto torch/nerfstudio.
# Fatal on failure: masking is a default-on quality feature, so a broken install
# must surface at build time, not silently ship a worker that can't mask.
RUN --mount=type=cache,target=/root/.cache/pip \
    python3 -m pip install "rembg[cpu]==2.0.*"
# Pre-bake the u2net model INTO the image: the worker runs read-only as uid
# 65532 (`/opt/u2net` is a+rX — not writable), so it can't fetch the model at
# runtime. Fatal too — a missing model means masking is dead on arrival, and a
# successful build now doubles as proof that onnxruntime + the model both work.
RUN mkdir -p /opt/u2net && \
    python3 -c "from rembg import new_session; new_session()" && \
    chmod -R a+rX /opt/u2net

COPY worker.py /app/worker.py

# Drop privileges — matches the compose hardening (no-new-privileges:true).
RUN useradd -u 65532 -m worker && \
    mkdir -p /work && chown -R worker /work
USER 65532
WORKDIR /work

CMD ["python3", "/app/worker.py"]

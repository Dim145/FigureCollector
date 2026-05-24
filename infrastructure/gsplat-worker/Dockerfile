# syntax=docker/dockerfile:1.7
#
# Phase 5B — Gaussian Splatting training sidecar.
#
# Pipeline at runtime:
#   1. Poll Postgres for `scans` rows in state='pending' AND kind='gsplat'
#   2. Download the N frames already in Garage
#   3. Run Nerfstudio's image processing (COLMAP SfM + camera poses)
#   4. Train `splatfacto` (gsplat-backed Gaussian Splatting)
#   5. Export `.ply`, upload to Garage as `scans/{id}/result.ply`
#   6. Mark the row `state='ready', result_key=…`
#
# Heavy by nature: ~10-15 GB image after build (CUDA dev tooling + PyTorch +
# nerfstudio + gsplat). Build it once on the GPU host; rebuilds reuse the
# CUDA + torch layers and only redo the small worker layer.
# -----------------------------------------------------------------------------

FROM nvidia/cuda:12.1.1-cudnn8-devel-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1 \
    CUDA_HOME=/usr/local/cuda \
    TORCH_CUDA_ARCH_LIST="7.0;7.5;8.0;8.6;8.9;9.0"

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip python3-dev \
    git \
    build-essential cmake ninja-build \
    libgl1 libglib2.0-0 libsm6 libxext6 libxrender1 \
    colmap \
    ffmpeg \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN python3 -m pip install --upgrade pip setuptools wheel

# PyTorch matching the base image's CUDA. Pinning is on purpose — gsplat ABI
# is tied to the torch build, and nerfstudio is fussy about compatible ranges.
RUN python3 -m pip install \
    torch==2.4.0 torchvision==0.19.0 \
    --index-url https://download.pytorch.org/whl/cu121

# Nerfstudio + gsplat (gsplat compiles CUDA kernels here; takes ~5-10 min).
RUN python3 -m pip install nerfstudio==1.1.5

# Runtime deps for our worker.
RUN python3 -m pip install \
    asyncpg==0.30.0 \
    boto3==1.35.* \
    structlog==24.4.*

WORKDIR /app
COPY worker.py /app/worker.py

RUN useradd -u 65532 -m worker && \
    mkdir -p /work && chown -R worker /work
USER 65532
WORKDIR /work

CMD ["python3", "/app/worker.py"]

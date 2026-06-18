# syntax=docker/dockerfile:1.7
#
# Phase 5B — Gaussian Splatting training sidecar (slim CUDA 12 base).
#
# Built on the tiny CUDA 12.9 `-base` image (~140 MB — cudart + env only). What
# keeps it slim: the CUDA math libs (cuDNN, cuBLAS, cuFFT, cuSPARSE…) ship ONCE,
# from torch, instead of also being baked into a heavy `-runtime`/`-cudnn` base
# (~2 GB saved):
#   * torch 2.4.1 + cu124 and gsplat 1.5.3 (prebuilt pt24cu124 wheel — no nvcc, no
#     runtime JIT → works in the read-only container) → the MCMC trainer. torch
#     bundles the full CUDA runtime; we register its CUDA lib dirs with ldconfig
#     (below) so onnxruntime reuses them instead of duplicating from the base.
#   * COLMAP 4.0.4 (conda-forge CUDA build, cuda_129) → the whole SfM, GPU; the
#     conda env carries its own CUDA 12.9 runtime, self-contained.
#   * onnxruntime-gpu (CUDA 12) → rembg masking, reusing torch's CUDA libs.
# Base MUST be ubuntu22.04 → Python 3.10, the ONLY interpreter gsplat ships a
# wheel for (24.04 = Python 3.12 → no wheel). Needs a CUDA 12.x-capable GPU.
#
# Override the base for reproducibility with --build-arg CUDA_IMAGE=…
ARG CUDA_IMAGE=nvidia/cuda:12.9.2-base-ubuntu22.04
FROM ${CUDA_IMAGE}

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_BREAK_SYSTEM_PACKAGES=1 \
    U2NET_HOME=/opt/u2net \
    # COLMAP (conda 4.0.4) is Qt-linked; offscreen platform = no X server needed.
    QT_QPA_PLATFORM=offscreen

# System deps: Python 3.10 (the gsplat-wheel interpreter), ffmpeg (frame
# sampling), curl/ca-certs (downloads), libglib2.0-0 (rembg's opencv-headless).
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 python3-pip ffmpeg curl ca-certificates libglib2.0-0 && \
    rm -rf /var/lib/apt/lists/*
# (No `pip install --upgrade pip`: the base's pip is Debian-managed — upgrading it
# fails with "Cannot uninstall pip … RECORD file not found" — and 24.0 is fine.)

# torch first, from the CUDA 12.4 index (gsplat's pt24cu124 wheel is built against
# exactly torch 2.4 + cu124). PyPI as extra so torch's non-CUDA deps resolve.
RUN --mount=type=cache,target=/root/.cache/pip \
    python3 -m pip install torch==2.4.1 \
      --index-url https://download.pytorch.org/whl/cu124 \
      --extra-index-url https://pypi.org/simple

# gsplat 1.5.3 — the CUDA rasteriser the trainer drives. The prebuilt
# pt24cu124 / cp310 wheel from gsplat's own index bakes the CUDA kernels in (no
# nvcc, no first-use JIT) — required, since the worker runs read-only. The exact
# local-version pin (`+pt24cu124`) selects that wheel; deps come from PyPI; torch
# is already satisfied. (gsplat_mcmc.py's MCMC + rasterization calls are
# API-identical from 1.4.0 through 1.5.3 — verified — so the bump needs no code.)
RUN --mount=type=cache,target=/root/.cache/pip \
    python3 -m pip install "gsplat==1.5.3+pt24cu124" \
      --extra-index-url https://docs.gsplat.studio/whl/pt24cu124

# Worker runtime deps + rembg (GPU masking). onnxruntime-gpu's current wheel
# targets CUDA 12 / cuDNN 9 — matches this base, so no version pin (unlike the old
# CUDA 11.8 image, which needed 1.18.x). It also carries the CPU provider, so the
# worker degrades to CPU if the CUDA EP can't bind (it logs which one bound).
RUN --mount=type=cache,target=/root/.cache/pip \
    python3 -m pip install \
      asyncpg==0.30.0 "boto3==1.35.*" "structlog==24.4.*" \
      "rembg==2.0.*" onnxruntime-gpu "tokenizers==0.23.1"

# onnxruntime's CUDA EP dlopens the BARE soname `libnvrtc.so`; torch ships NVRTC
# only as the versioned libnvrtc.so.12, so drop an unversioned symlink on the
# loader path (the cu12 flavour of the old fix). Best-effort — if NVRTC isn't
# found, rembg simply runs on CPU.
RUN --mount=type=cache,target=/root/.cache/pip \
    python3 -m pip install nvidia-cuda-nvrtc-cu12 && \
    src="$(find / -path '*/nvidia/cuda_nvrtc/lib/libnvrtc.so.12*' 2>/dev/null | head -n1)" && \
    if [ -n "$src" ]; then \
      cp -dn "$src" /usr/local/lib/ && \
      ln -sf "$(ls /usr/local/lib/libnvrtc.so.12* | head -n1)" /usr/local/lib/libnvrtc.so && \
      ldconfig && echo "NVRTC wired:" && ls -l /usr/local/lib/libnvrtc*; \
    else echo "WARN: libnvrtc.so.12 not found — rembg will run on CPU"; fi
ENV LD_LIBRARY_PATH=/usr/local/lib:${LD_LIBRARY_PATH}

# `-base` ships only cudart — the CUDA math libs (cuDNN, cuBLAS, cuFFT, cuSPARSE,
# cuRAND…) come from torch's bundle. Register ALL of torch's CUDA lib dirs with
# ldconfig so onnxruntime's CUDA EP resolves them by soname (libcudnn.so.9,
# libcublas.so.12, …). Versioned sonames → ldconfig suffices (the bare libnvrtc.so
# is handled separately above). Best-effort: rembg falls back to CPU if absent.
RUN dirs="$(find / -type d -path '*/dist-packages/nvidia/*/lib' 2>/dev/null | sort -u)" && \
    if [ -n "$dirs" ]; then \
      printf '%s\n' "$dirs" > /etc/ld.so.conf.d/torch-cuda.conf && ldconfig && \
      echo "torch CUDA libs registered:" && cat /etc/ld.so.conf.d/torch-cuda.conf; \
    else echo "WARN: torch CUDA libs not found — GPU rembg falls back to CPU"; fi

# Pre-bake the rembg model (read-only container, uid 65532 can't fetch at runtime).
# isnet-general-use: ISNet/DIS (2022) — crisper than the old u2net, and its CNN
# architecture FITS a 6 GB card (~1-2 GB at 1024²). We ALSO bake birefnet-general
# (~928 MB; ~3.5-4.8 GB at 1024², fits 6 GB since masking runs BEFORE training) —
# cleaner edges on hair/fine detail. Pick either via REMBG_MODEL. (isnet ~170 MB.)
# Download it directly (rembg's own URL + MD5) instead of via `new_session`: that
# would spin up an onnxruntime InferenceSession at build, which on a GPU-less host
# logs an alarming "GPU device discovery failed /sys/class/drm" warning and can
# stall under emulation. rembg loads `$U2NET_HOME/<model>.onnx`, so save under that
# exact name; the MD5 check guarantees the worker finds it (no re-download attempt).
# To switch models, change this URL+MD5 and REMBG_MODEL in worker.py together.
RUN mkdir -p /opt/u2net && \
    curl -fSL -o /opt/u2net/isnet-general-use.onnx \
      https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-general-use.onnx && \
    echo "fc16ebd8b0c10d971d3513d564d01e29  /opt/u2net/isnet-general-use.onnx" | md5sum -c - && \
    curl -fSL -o /opt/u2net/birefnet-general.onnx \
      https://github.com/danielgatis/rembg/releases/download/v0.0.0/BiRefNet-general-epoch_244.onnx && \
    echo "7a35a0141cbbc80de11d9c9a28f52697  /opt/u2net/birefnet-general.onnx" | md5sum -c - && \
    chmod -R a+rX /opt/u2net

# COLMAP 4.0.x learned-feature ONNX for the opt-in SFM_FEATURES=aliked path: the
# ALIKED extractor (aliked-n16rot) + the ALIKED-LightGlue matcher. Baked because
# the read-only container can't fetch them at runtime (COLMAP would otherwise pull
# them from GitHub on first use). SHA256s are COLMAP's own published release values
# (its --*_model_path defaults). Left unused unless SFM_FEATURES=aliked.
RUN mkdir -p /opt/colmap-models && \
    curl -fSL -o /opt/colmap-models/aliked-n16rot.onnx \
      https://github.com/colmap/colmap/releases/download/3.13.0/aliked-n16rot.onnx && \
    echo "39c423d0a6f03d39ec89d3d1d61853765c2fb6a8b8381376c703e5758778a547  /opt/colmap-models/aliked-n16rot.onnx" | sha256sum -c - && \
    curl -fSL -o /opt/colmap-models/aliked-lightglue.onnx \
      https://github.com/colmap/colmap/releases/download/3.13.0/aliked-lightglue.onnx && \
    echo "b9a5de7204648b18a8cf5dcac819f9d30de1a5961ef03756803c8b86c2dceb8d  /opt/colmap-models/aliked-lightglue.onnx" | sha256sum -c - && \
    chmod -R a+rX /opt/colmap-models

# COLMAP 4.0.4 (CUDA build) — the WHOLE Structure-from-Motion, into an isolated
# micromamba env. It's the exact COLMAP the macOS worker runs (Homebrew 4.0.4),
# whose reworked incremental mapper is why glossy turntables reconstruct reliably.
# Pin 4.0.4 explicitly: conda-forge's `=cpu*` glob silently resolved to 3.11.1.
# CONDA_OVERRIDE_CUDA=12.9 lets the `cuda_129` build's `__cuda >=12.9` constraint
# pass on a GPU-less build host (the host's NVIDIA driver provides it at runtime).
#
# faiss: COLMAP 4.0 links libfaiss.so, but the conda-forge recipe forgets to
# declare it — so we add it (cpu_openblas build: light, no MKL, no extra CUDA libs;
# COLMAP only uses faiss's CPU index). NB the build glob must be a trailing-*
# PREFIX ("cpu_openblas*"); micromamba's MatchSpec parser rejects a LEADING *.
# Then smoke-test that colmap's shared libs resolve — a missing one fails the BUILD.
COPY --from=mambaorg/micromamba:latest /bin/micromamba /usr/local/bin/micromamba
ENV MAMBA_ROOT_PREFIX=/opt/micromamba
# Bake the env into a PLAIN layer — deliberately NOT a `--mount=type=cache`.
# Docker Desktop's BuildKit GC caps cache-mounts (`exec.cachemount`) at only
# ~2.8 GiB total, but this conda env's package cache is ~2 GB, so a mount-based
# step gets pruned on essentially every build and re-runs from scratch. A plain
# RUN layer instead lives under the generous regular-layer GC budget (~20 GiB
# reserved) and stays cached across builds. `micromamba clean` drops the package
# tarballs so the baked layer stays slim; the `colmap help` smoke test catches an
# incomplete env.
RUN CONDA_OVERRIDE_CUDA=12.9 micromamba create -y -n sfm -c conda-forge \
      "colmap=4.0.4=cuda_*" "libfaiss=*=cpu_openblas*" && \
    micromamba clean -a -y && \
    test -x /opt/micromamba/envs/sfm/bin/colmap && \
    micromamba list -n sfm colmap && micromamba list -n sfm libfaiss && \
    ( micromamba run -n sfm colmap help 2>&1 | grep -qi "error while loading" \
      && { echo "FATAL: COLMAP shared libs unresolved"; exit 1; } || true ) && \
    chmod -R a+rX /opt/micromamba

# Assert the gsplat API the trainer targets (1.5.3) imports — a wheel/version
# drift fails the BUILD here, not a ~40-min run.
RUN python3 -c "import gsplat; from gsplat import rasterization; from gsplat.strategy import MCMCStrategy; print('gsplat', getattr(gsplat, '__version__', '?'))"

# ONNX models for the embed loops (embed_index.py runs concurrently with
# training). The SAME models the browser loads so query + index vectors share
# one space. Image (Xenova/dinov2-small): two graphs — q8 for CPU
# (EMBED_DEVICE=cpu, the default) and fp16 for the GPU (EMBED_DEVICE=cuda); the
# q8 graph's int8 ops fall back to CPU on CUDA (Memcpy churn), fp16 runs fully on
# the GPU (its vectors match q8 to ~0.008 cosine). Text (Xenova/multilingual-e5-
# small): q8 only — text indexing is low-volume, so CPU is fine even here — plus
# its tokenizer.json. Baked because the read-only container (uid 65532) can't
# fetch at runtime. Deliberately LAST (just before the cheap source COPYs): keeps
# it off the critical path so re-baking never invalidates the ~2 GB conda/COLMAP
# layer above it.
RUN mkdir -p /models/dinov2-small /models/e5-small && \
    curl -fSL -o /models/dinov2-small/model_quantized.onnx \
      https://huggingface.co/Xenova/dinov2-small/resolve/main/onnx/model_quantized.onnx && \
    echo "3afdc8bc63b50558d6e5770f5b799bb82455c2311183a2de43803f343a29d917  /models/dinov2-small/model_quantized.onnx" | sha256sum -c - && \
    curl -fSL -o /models/dinov2-small/model_fp16.onnx \
      https://huggingface.co/Xenova/dinov2-small/resolve/main/onnx/model_fp16.onnx && \
    echo "4e9ea6fe106e2225e28ee3c1c3d53b5b92aa4af62142f6ed6b66b6a92213cf04  /models/dinov2-small/model_fp16.onnx" | sha256sum -c - && \
    curl -fSL -o /models/e5-small/model_quantized.onnx \
      https://huggingface.co/Xenova/multilingual-e5-small/resolve/main/onnx/model_quantized.onnx && \
    echo "f80102d3f2a1229f387d3c81909990d8945513e347b0eab049f7de3c6f98c193  /models/e5-small/model_quantized.onnx" | sha256sum -c - && \
    curl -fSL -o /models/e5-small/tokenizer.json \
      https://huggingface.co/Xenova/multilingual-e5-small/resolve/main/tokenizer.json && \
    echo "0b44a9d7b51c3c62626640cda0e2c2f70fdacdc25bbbd68038369d14ebdf4c39  /models/e5-small/tokenizer.json" | sha256sum -c - && \
    mkdir -p /models/siglip2 && \
    curl -fSL -o /models/siglip2/vision_model_quantized.onnx \
      https://huggingface.co/onnx-community/siglip2-base-patch16-224-ONNX/resolve/main/onnx/vision_model_quantized.onnx && \
    echo "5f2b401c1a4fc095702a5d45348e17ad46c4f87064085365b43c6e8eaa5c0070  /models/siglip2/vision_model_quantized.onnx" | sha256sum -c - && \
    chmod -R a+rX /models

COPY worker.py /app/worker.py
COPY gsplat_mcmc.py /app/gsplat_mcmc.py
COPY embed_index.py /app/embed_index.py

# Drop privileges — matches the compose hardening (no-new-privileges:true).
RUN useradd -u 65532 -m worker && \
    mkdir -p /work && chown -R worker /work
USER 65532
WORKDIR /work

CMD ["python3", "/app/worker.py"]

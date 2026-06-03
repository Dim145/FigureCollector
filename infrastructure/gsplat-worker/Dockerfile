# syntax=docker/dockerfile:1.7
#
# Phase 5B — Gaussian Splatting training sidecar (slim CUDA 12 base).
#
# Rebased off the ~15 GB Nerfstudio image onto the TINY CUDA 12.9 `-base` image
# (~140 MB — cudart + env only) — we used only a handful of things from
# nerfstudio, and its COLMAP 3.9.1 was the wrong version anyway. The trick: the
# CUDA math libs (cudnn, cublas, cufft, cusparse…) ship ONCE, from torch, instead
# of also being baked into a heavy `-runtime`/`-cudnn` base (~2 GB saved):
#   * torch 2.4.1 + cu124 and gsplat 1.5.3 (prebuilt pt24cu124 wheel — no nvcc, no
#     runtime JIT → works in the read-only container) → the MCMC trainer. torch
#     bundles the full CUDA runtime; we register its CUDA lib dirs with ldconfig
#     (below) so onnxruntime reuses them instead of duplicating from the base.
#   * COLMAP 4.0.4 (conda-forge CUDA build, cuda_129) → the whole SfM, GPU; the
#     conda env carries its own CUDA 12.9 runtime, self-contained.
#   * onnxruntime-gpu (CUDA 12) → rembg masking, reusing torch's CUDA libs.
# Base MUST be ubuntu22.04 → Python 3.10, the ONLY interpreter gsplat ships a
# wheel for (24.04 = Python 3.12 → no wheel). Targets the RTX 3050/3060 (sm_86);
# the host's 575 driver covers CUDA 12.x.
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
      "rembg==2.0.*" onnxruntime-gpu

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
# architecture FITS a 6 GB card (~1-2 GB at 1024²). BiRefNet is higher quality but
# OOMs 6 GB at its 1024² input (needs ~8 GB+), so we don't bake it here. ~170 MB.
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
    chmod -R a+rX /opt/u2net

# COLMAP 4.0.4 (CUDA build) — the WHOLE Structure-from-Motion, into an isolated
# micromamba env. It's the exact COLMAP the macOS worker runs (Homebrew 4.0.4),
# whose reworked incremental mapper is why glossy turntables reconstruct reliably.
# Pin 4.0.4 explicitly: conda-forge's `=cpu*` glob silently resolved to 3.11.1.
# CONDA_OVERRIDE_CUDA=12.9 lets the `cuda_129` build's `__cuda >=12.9` constraint
# pass on a GPU-less build host (the 575 driver provides it at runtime).
#
# faiss: COLMAP 4.0 links libfaiss.so, but the conda-forge recipe forgets to
# declare it — so we add it (cpu_openblas build: light, no MKL, no extra CUDA libs;
# COLMAP only uses faiss's CPU index). NB the build glob must be a trailing-*
# PREFIX ("cpu_openblas*"); micromamba's MatchSpec parser rejects a LEADING *.
# Then smoke-test that colmap's shared libs resolve — a missing one fails the BUILD.
COPY --from=mambaorg/micromamba:latest /bin/micromamba /usr/local/bin/micromamba
ENV MAMBA_ROOT_PREFIX=/opt/micromamba
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

COPY worker.py /app/worker.py
COPY gsplat_mcmc.py /app/gsplat_mcmc.py

# Drop privileges — matches the compose hardening (no-new-privileges:true).
RUN useradd -u 65532 -m worker && \
    mkdir -p /work && chown -R worker /work
USER 65532
WORKDIR /work

CMD ["python3", "/app/worker.py"]

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

# rembg for foreground masking (ENABLE_MASKING, default on) — on the GPU. rembg's
# inference backend is onnxruntime, which rembg 2.0.x moved OUT of its core deps
# into extras, so a bare `rembg` fails at import with "No module named
# 'onnxruntime'". We want the GPU build → install `onnxruntime-gpu`.
#
# onnxruntime-gpu is HARD-LOCKED to a CUDA + cuDNN line, so pin to the wheel that
# matches the base image. This base is CUDA 11.8 / cuDNN 8 → the 1.18.x line is
# the last default-PyPI wheel for that combo (1.19+ switched the default to
# CUDA 12 / cuDNN 9). We read torch's CUDA major from the base so the pin still
# resolves if the image ever moves to CUDA 12 (latest onnxruntime-gpu = CUDA 12).
# onnxruntime-gpu also carries the CPU provider, so the worker degrades to CPU if
# the CUDA EP can't bind at runtime (it logs which provider actually bound).
# Fatal: masking is default-on, so a broken install must surface at build time.
RUN --mount=type=cache,target=/root/.cache/pip \
    CUDA_MAJOR="$(python3 -c 'import torch,sys; v=torch.version.cuda or ""; sys.stdout.write(v.split(".")[0] if v else "")')" && \
    echo "base torch CUDA major=${CUDA_MAJOR:-unknown}" && \
    if [ "$CUDA_MAJOR" = "11" ]; then ORT="onnxruntime-gpu==1.18.*"; else ORT="onnxruntime-gpu"; fi && \
    echo "installing ${ORT}" && \
    python3 -m pip install "rembg==2.0.*" "$ORT"

# onnxruntime-gpu's CUDA EP (cuDNN 8 runtime-fusion) dlopens the BARE soname
# `libnvrtc.so`. The base bundles NVRTC only under torch's hash-mangled name
# (libnvrtc-<hash>.so.11.2), so cuDNN can't resolve `libnvrtc.so` and ABORTS the
# process — the `Could not load library libcudnn_cnn_infer.so.8 … libnvrtc.so`
# crash-loop. Install a clean-named NVRTC (+ its builtins), drop it in
# /usr/local/lib under the bare name, and put that dir on LD_LIBRARY_PATH — a
# bare-soname dlopen scans LD_LIBRARY_PATH, whereas ldconfig's cache only
# resolves versioned SONAMEs, not the unversioned `.so` symlink.
RUN --mount=type=cache,target=/root/.cache/pip \
    python3 -m pip install nvidia-cuda-nvrtc-cu11 && \
    src="$(find /usr -path '*/nvidia/cuda_nvrtc/lib' -type d | head -n1)" && \
    test -n "$src" && \
    cp -dn "$src"/libnvrtc* /usr/local/lib/ && \
    ln -sf "$(ls /usr/local/lib/libnvrtc.so.11* | head -n1)" /usr/local/lib/libnvrtc.so && \
    ldconfig && \
    echo "NVRTC wired:" && ls -l /usr/local/lib/libnvrtc*
ENV LD_LIBRARY_PATH=/usr/local/lib:${LD_LIBRARY_PATH}

# Pre-bake the u2net model INTO the image: the worker runs read-only as uid 65532
# (`/opt/u2net` is a+rX — not writable), so it can't fetch the model at runtime.
# The BUILD host has no GPU, so download via the CPU provider — the model files
# are identical; the worker picks the CUDA provider at runtime. Fatal too — a
# green build now proves onnxruntime-gpu imports cleanly and the model is present.
RUN mkdir -p /opt/u2net && \
    python3 -c "from rembg import new_session; new_session('u2net', providers=['CPUExecutionProvider'])" && \
    chmod -R a+rX /opt/u2net

# COLMAP 4.x — for the incremental MAPPER only. This image's COLMAP 3.9.1
# incremental mapper is multi-threaded non-deterministic (the same turntable
# registered 2/100 frames one run, 100/100 the next); COLMAP 4.0's reworked
# mapper is what the macOS Homebrew COLMAP (4.x) runs — and why the Mac is
# reliable. It's not in this image; conda-forge has it prebuilt, so we install
# the CPU build (the mapper is CPU/Ceres — no CUDA, small) into an isolated
# micromamba env. The image's CUDA COLMAP 3.9.1 still does GPU feature extraction
# + matching; then `micromamba run -n sfm colmap mapper` consumes the database
# (the COLMAP DB format is backward-compatible 3.x → 4.x).
COPY --from=mambaorg/micromamba:latest /bin/micromamba /usr/local/bin/micromamba
ENV MAMBA_ROOT_PREFIX=/opt/micromamba
RUN micromamba create -y -n sfm -c conda-forge "colmap=*=cpu*" && \
    micromamba clean -a -y && \
    test -x /opt/micromamba/envs/sfm/bin/colmap && \
    chmod -R a+rX /opt/micromamba

# Brush — the Gaussian-splat TRAINER (wgpu → Vulkan on the NVIDIA GPU), the same
# trainer as the macOS worker. splatfacto on this data was soft + hazy; Brush is
# crisper and masks via the per-frame alpha. Install the Vulkan runtime + tools,
# then drop in the prebuilt Linux binary from the GitHub release.
RUN apt-get update && apt-get install -y --no-install-recommends \
      libvulkan1 vulkan-tools xz-utils ca-certificates curl && \
    rm -rf /var/lib/apt/lists/*
ARG BRUSH_VERSION=v0.3.0
RUN curl -fSL -o /tmp/brush.tar.xz \
      "https://github.com/ArthurBrussee/brush/releases/download/${BRUSH_VERSION}/brush-app-x86_64-unknown-linux-gnu.tar.xz" && \
    mkdir -p /tmp/brush-x && tar -xJf /tmp/brush.tar.xz -C /tmp/brush-x && \
    BIN="$(find /tmp/brush-x -type f -name 'brush*' | head -n1)" && \
    test -n "$BIN" && install -m 0755 "$BIN" /usr/local/bin/brush && \
    rm -rf /tmp/brush.tar.xz /tmp/brush-x && \
    test -x /usr/local/bin/brush

# NVIDIA Vulkan ICD — belt-and-suspenders for a known container-toolkit bug where
# the ICD loader file isn't injected even with the `graphics` capability. The
# NVIDIA Vulkan driver IS libGLX_nvidia.so.0 (despite the GLX name); the lib is
# mounted from the host driver at runtime. Requires NVIDIA_DRIVER_CAPABILITIES to
# include `graphics` (or `all`) in the compose — see docker-compose.gsplat.yml.
RUN mkdir -p /etc/vulkan/icd.d && \
    printf '%s\n' \
      '{' \
      '    "file_format_version": "1.0.0",' \
      '    "ICD": { "library_path": "libGLX_nvidia.so.0", "api_version": "1.3.0" }' \
      '}' > /etc/vulkan/icd.d/nvidia_icd.json

COPY worker.py /app/worker.py

# Drop privileges — matches the compose hardening (no-new-privileges:true).
RUN useradd -u 65532 -m worker && \
    mkdir -p /work && chown -R worker /work
USER 65532
WORKDIR /work

CMD ["python3", "/app/worker.py"]

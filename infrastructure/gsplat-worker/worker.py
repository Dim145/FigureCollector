"""
FigureCollector — Gaussian Splatting worker.

Polls the `scans` table for `state='pending' AND kind='gsplat'`, claims one
job at a time with `FOR UPDATE SKIP LOCKED`, runs the full SfM + training
pipeline locally on GPU, then uploads the result back to Garage and marks
the row as ready (or failed).

Frames flow:
  1. Prefer the scan's original video (`{prefix}source.*`) — full-res frames
     sampled by ffmpeg beat the downscaled WebP set the client uploads for
     the 360° viewer.
  2. Fall back to the WebP frame set when no source video is present.

Environment:
    DATABASE_URL          required, postgres://user:pass@host:5432/db
    S3_ENDPOINT           required, e.g. http://garage:3902
    S3_BUCKET             required
    S3_ACCESS_KEY         required
    S3_SECRET_KEY         required
    S3_REGION             optional, defaults to "garage"
    POLL_INTERVAL         optional, seconds between polls (default 10)
    TRAINING_ITERATIONS   optional, gsplat MCMC training iters (default 30000)
    VIDEO_TARGET_FRAMES   optional, frames sampled from a source video (default 150)
    VIDEO_MAX_DIM         optional, max-dim cap on extracted frames (default 2048)
    FFMPEG_USE_GPU        optional, GPU NVDEC decode for frame extraction (default
                          true); falls back to CPU on any failure
    GSPLAT_CAP_MAX        optional, MCMC Gaussian cap — the VRAM lever (default 250000)
    GSPLAT_MAX_RES        optional, longest image side trained on (default 1600)
    ENABLE_MASKING        optional, rembg-mask the figure (default true) — a binary
                          mask feeds COLMAP's mask_path (SfM tracks the figure) AND the
                          trainer's loss (background pixels contribute zero loss)
    COLMAP_USE_GPU        optional, GPU COLMAP SIFT extraction + matching (default
                          true); false forces CPU (deterministic).
    COLMAP_BA_USE_GPU     optional, GPU bundle adjustment in the mapper (default
                          false); rarely helps at ~150 frames, falls back to CPU if
                          Ceres lacks CUDA. Otherwise the mapper is CPU/Ceres.
    RECOVER_ABANDONED     optional, at boot re-queue this worker's 'processing'
                          scans abandoned on a restart (default true)
"""

from __future__ import annotations

import asyncio
import gc
import json
import os
import platform
import re
import shutil
import socket
import struct
import subprocess
import tempfile
import traceback
import uuid
from collections import deque
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import asyncpg
import boto3
import structlog
from botocore.config import Config as BotoConfig
from PIL import Image

# -----------------------------------------------------------------------------
# Config
# -----------------------------------------------------------------------------

DATABASE_URL = os.environ["DATABASE_URL"]
S3_ENDPOINT = os.environ["S3_ENDPOINT"]
S3_BUCKET = os.environ["S3_BUCKET"]
S3_ACCESS_KEY = os.environ["S3_ACCESS_KEY"]
S3_SECRET_KEY = os.environ["S3_SECRET_KEY"]
S3_REGION = os.environ.get("S3_REGION", "garage")
POLL_INTERVAL = int(os.environ.get("POLL_INTERVAL", "10"))
TRAINING_ITERATIONS = int(os.environ.get("TRAINING_ITERATIONS", "30000"))
# When a scan ships its original video (key `{prefix}source.*`), we extract
# our own frames from it with ffmpeg — far more of them, and from a lossless
# source, than the downscaled WebP set the client uploads for the 360° viewer.
# Defaults are kept in lockstep with `splat-worker-mac` so both workers behave
# the same on the same scan.
VIDEO_TARGET_FRAMES = int(os.environ.get("VIDEO_TARGET_FRAMES", "150"))
# Cap the longest side of extracted frames. 4K is overkill for SfM + Gaussian
# splatting and makes COLMAP matching / training crawl; ~2048 px is the sweet
# spot (well above the client's 1920 px WebP, still fast).
VIDEO_MAX_DIM = int(os.environ.get("VIDEO_MAX_DIM", "2048"))
# Decode the source video on the GPU (NVDEC) when extracting frames. Needs the
# `video` driver capability (NVIDIA_DRIVER_CAPABILITIES=all, which we set). Only
# the DECODE moves to the GPU — the PNG encode stays CPU, so the win is modest.
# Any failure (a codec/profile NVDEC can't handle, no GPU) falls back to CPU.
FFMPEG_USE_GPU = os.environ.get("FFMPEG_USE_GPU", "true").lower() in ("1", "true", "yes")
# Background masking. On by default — this is an object scanner, so the figure
# should be isolated from whatever it sits on. When on, rembg masks each frame
# (before COLMAP) and we feed them BOTH to COLMAP's mask_path (so SfM ignores the
# static turntable backdrop — essential, or it registers almost nothing) AND as
# per-frame loss masks so the gsplat trainer ignores the background (no haze).
# Best-effort: if rembg is missing or errors, COLMAP and training run unmasked.
ENABLE_MASKING = os.environ.get("ENABLE_MASKING", "true").lower() in ("1", "true", "yes")
# rembg segmentation model. Default isnet-general-use (ISNet/DIS, 2022 — crisp,
# light: ~1-2 GB at 1024²). For cleaner edges on hair/fine detail, birefnet-general
# is higher quality and DOES fit 6 GB (~3.5-4.8 GB at 1024², and masking runs
# BEFORE training so it never competes with the trainer's VRAM). Whichever model
# is set here MUST be baked into the image (read-only container can't fetch one at
# runtime) — to A/B BiRefNet, bake birefnet-general.onnx into the Dockerfile first.
# Only isnet-general-use is baked by default.
REMBG_MODEL = os.environ.get("REMBG_MODEL", "isnet-general-use")
# COLMAP SIFT feature extraction + matching on the GPU (the conda env ships the
# CUDA build of COLMAP 4.0.4). Default on. Set COLMAP_USE_GPU=false to force CPU
# for both — slower, but COLMAP's CUDA SIFT extraction is non-deterministic (GPU
# float atomics), so if a glossy turntable flaps between a full model and a
# 2-frame stub, flip this off (the macOS worker extracts on CPU on purpose). The
# incremental mapper is always CPU/Ceres.
COLMAP_USE_GPU = os.environ.get("COLMAP_USE_GPU", "true").lower() in ("1", "true", "yes")
# Bundle adjustment in the incremental mapper runs on CPU (Ceres) by default.
# COLMAP_BA_USE_GPU=true passes --Mapper.ba_use_gpu 1 to try Ceres' CUDA solver.
# Rarely worth it here: GPU BA only pays off on LARGE reconstructions (~1500+
# images) — at ~150 frames it's usually no faster, often slower (host<->GPU
# transfer) — and it silently falls back to CPU if this COLMAP's Ceres wasn't
# built with CUDA. Off by default; flip it on to experiment.
COLMAP_BA_USE_GPU = os.environ.get("COLMAP_BA_USE_GPU", "false").lower() in ("1", "true", "yes")

# COLMAP is Qt-linked; force Qt's offscreen platform so the CLI initialises with
# no X server. The Dockerfile sets this too — this is belt-and-suspenders for
# running the worker outside the image. CUDA SIFT needs no GL context.
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

# At boot, re-queue scans this worker left in 'processing' when its previous
# incarnation was restarted mid-job. Disable with RECOVER_ABANDONED=false.
RECOVER_ABANDONED = os.environ.get("RECOVER_ABANDONED", "true").lower() in ("1", "true", "yes")

# Worker registration. The backend's offline detector waits 3 × this interval
# (per `domain::worker::OFFLINE_MISS_THRESHOLD`) before flagging us offline,
# so 30s here ≈ 90s of grace before the admin UI marks us hors-ligne.
HEARTBEAT_INTERVAL = int(os.environ.get("HEARTBEAT_INTERVAL", "30"))
WORKER_KIND = "cuda"
WORKER_VERSION = "0.16.0"

MIN_FRAMES = 6
# COLMAP must register at least this many frames for a non-degenerate sparse
# model. Fewer (e.g. a turntable COLMAP couldn't solve) yields a near-empty
# point cloud → too few gaussians → a degenerate splat or a hard crash in the
# trainer. Fail clean with an actionable message instead.
MIN_REGISTERED = 10

# SIFT features per image for COLMAP extraction. 8192 is plenty for a turntable
# (closely-spaced views) and roughly halves matching + the CPU mapper's bundle
# adjustment vs 16384 — on glossy figures the extra detections are mostly
# unstable, view-dependent highlight noise. Bump to 16384 if registration drops
# on a hard capture (it's the macOS worker's value).
COLMAP_MAX_FEATURES = int(os.environ.get("COLMAP_MAX_FEATURES", "8192"))

# gsplat MCMC trainer knobs (see gsplat_mcmc.py). GSPLAT_CAP_MAX is the MCMC
# Gaussian cap — the dominant VRAM lever (MCMC grows to the cap, then holds it);
# 250k fits a single figure on a 6 GB card. GSPLAT_MAX_RES caps the longest image
# side trained on (the other VRAM lever). Raise either for sharper results if VRAM
# allows; lower them on out-of-memory. The trainer ships next to this worker.
GSPLAT_CAP_MAX = int(os.environ.get("GSPLAT_CAP_MAX", "250000"))
GSPLAT_MAX_RES = int(os.environ.get("GSPLAT_MAX_RES", "1600"))
# Undistort to a PINHOLE dataset (colmap image_undistorter) before training. The
# trainer rasterises a pinhole camera and ignores OPENCV distortion, so this
# keeps the projection honest (fewer edge floaters). false = train on the raw
# distorted frames.
GSPLAT_UNDISTORT = os.environ.get("GSPLAT_UNDISTORT", "true").lower() in ("1", "true", "yes")

# COLMAP feature backend. "sift" (default, proven) or "aliked" — learned ALIKED
# features + LightGlue matching (built into COLMAP 4.0.4), far more repeatable on
# glossy/low-texture surfaces where SIFT latches onto moving speculars → better
# poses → sharper splats. ALIKED needs its ONNX models, BAKED into the image (the
# read-only container can't fetch them at runtime). Opt-in: A/B it against SIFT.
SFM_FEATURES = os.environ.get("SFM_FEATURES", "sift").lower()
ALIKED_MAX_FEATURES = int(os.environ.get("ALIKED_MAX_FEATURES", "4096"))
COLMAP_MODELS_DIR = os.environ.get("COLMAP_MODELS_DIR", "/opt/colmap-models")
# SfM mapper. "incremental" (default) or "global" — COLMAP 4.0's built-in GLOMAP
# (global SfM solves the whole turntable at once, no incremental drift). A/B it.
SFM_MAPPER = os.environ.get("SFM_MAPPER", "incremental").lower()
# GLOMAP cube-collapse mitigation (SFM_MAPPER=global). Global SfM on a DENSE
# single-object match graph (ALIKED+LightGlue) can collapse to a degenerate "cube".
# COLMAP's global_mapper has NO max-tracks cap (the standalone GLOMAP option is
# rejected); the exposed lever is the MINIMUM VIEWS PER TRACK — raising it keeps only
# well-supported tracks → fewer tracks. 0 = COLMAP default; try 4-5 only if it collapses.
GLOMAP_MIN_VIEWS_PER_TRACK = int(os.environ.get("GLOMAP_MIN_VIEWS_PER_TRACK", "0"))
# Sharpest-frame selection: oversample the video, then keep the sharpest frame per
# evenly-spaced time bucket (variance-of-Laplacian), dropping motion-blurred frames
# that soften the splat. Falls back to plain uniform sampling if cv2 is missing.
FRAME_SHARP_SELECT = os.environ.get("FRAME_SHARP_SELECT", "true").lower() in ("1", "true", "yes")
VIDEO_OVERSAMPLE = max(1, int(os.environ.get("VIDEO_OVERSAMPLE", "3")))

GSPLAT_TRAINER = Path(__file__).resolve().parent / "gsplat_mcmc.py"

log = structlog.get_logger()

s3 = boto3.client(
    "s3",
    endpoint_url=S3_ENDPOINT,
    aws_access_key_id=S3_ACCESS_KEY,
    aws_secret_access_key=S3_SECRET_KEY,
    region_name=S3_REGION,
    # Garage only speaks path-style.
    config=BotoConfig(s3={"addressing_style": "path"}, signature_version="s3v4"),
)

# -----------------------------------------------------------------------------
# Main loop
# -----------------------------------------------------------------------------


@dataclass
class WorkerState:
    """Mutable snapshot shared between the heartbeat task and the main loop:
    the heartbeat refreshes `enabled` from the row each tick so the claim
    loop can short-circuit while the admin has us disabled."""
    id: uuid.UUID
    enabled: bool


def log_gpu_diagnostics() -> None:
    """Boot-time GPU self-test. Logs the CUDA device torch sees + nvidia-smi — the
    one GPU that runs the CUDA work here: COLMAP 4.0.4 SIFT (extraction + matching,
    unless COLMAP_USE_GPU=false), rembg masking and the gsplat MCMC training. If
    CUDA is missing here, this would all be unusably slow."""
    # (1) CUDA compute — drives COLMAP SIFT, rembg, and gsplat training.
    try:
        import torch  # local import: heavy, only needed for the probe
        if torch.cuda.is_available():
            devs = []
            for i in range(torch.cuda.device_count()):
                p = torch.cuda.get_device_properties(i)
                devs.append(f"{p.name} ({p.total_memory // (1024 * 1024)} MiB)")
            log.info("gpu: CUDA available (COLMAP SIFT, rembg, gsplat training)",
                     devices=devs, cuda=torch.version.cuda)
        else:
            log.warning("gpu: CUDA NOT available to torch — splat training would be unusably slow")
    except Exception as e:  # noqa: BLE001
        log.warning("gpu: torch/CUDA probe failed", error=str(e))

    # (2) Does the NVIDIA runtime even expose the card to the container?
    try:
        smi = subprocess.run(
            ["nvidia-smi", "--query-gpu=name,memory.total,driver_version",
             "--format=csv,noheader"],
            capture_output=True, text=True, timeout=15,
        )
        if smi.returncode == 0:
            log.info("gpu: nvidia-smi", gpus=smi.stdout.strip())
        else:
            log.warning("gpu: nvidia-smi failed", err=smi.stderr.strip()[:200])
    except Exception as e:  # noqa: BLE001
        log.warning("gpu: nvidia-smi unavailable (compute not exposed?)", error=str(e))

    # (3) COLMAP 4.0.4 SfM — GPU feature extraction + matching unless
    #     COLMAP_USE_GPU=false; the mapper's bundle adjustment is CPU unless
    #     COLMAP_BA_USE_GPU.
    log.info("gpu: COLMAP 4.0.4",
             extraction_matching="CUDA (GPU)" if COLMAP_USE_GPU else "CPU",
             mapper_ba="CUDA (GPU)" if COLMAP_BA_USE_GPU else "CPU")


async def main() -> None:
    pool = await asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=4)
    state = await _register_worker(pool)
    log.info(
        "worker started",
        worker_id=str(state.id),
        kind=WORKER_KIND,
        enabled=state.enabled,
        heartbeat=HEARTBEAT_INTERVAL,
        poll_interval=POLL_INTERVAL,
        bucket=S3_BUCKET,
        iterations=TRAINING_ITERATIONS,
    )
    log_gpu_diagnostics()
    if RECOVER_ABANDONED:
        try:
            n = await recover_abandoned(pool, state.id)
            if n:
                log.info("recovered abandoned scans → re-queued", count=n, worker_id=str(state.id))
        except Exception as e:  # noqa: BLE001
            log.warning("recover_abandoned failed", error=str(e))
    heartbeat_task = asyncio.create_task(_heartbeat_loop(pool, state))
    try:
        while True:
            # Admin can flip `enabled` off at any moment; the heartbeat
            # refreshes it. Idle politely instead of claiming.
            if not state.enabled:
                await asyncio.sleep(POLL_INTERVAL)
                continue
            scan = await claim_next_pending(pool, state.id)
            if scan is None:
                await asyncio.sleep(POLL_INTERVAL)
                continue
            scan_id = scan["id"]
            log.info("scan claimed", scan_id=str(scan_id))
            loop = asyncio.get_running_loop()

            def report(pct, _sid=scan_id):
                # Best-effort progress from the worker thread → DB. Fire-and-
                # forget onto the event loop; never let it fail the job.
                try:
                    asyncio.run_coroutine_threadsafe(set_progress(pool, _sid, pct), loop)
                except Exception:  # noqa: BLE001
                    pass

            try:
                result_key = await asyncio.to_thread(process_scan, scan, report)
                await mark_ready(pool, scan_id, result_key)
                log.info("scan ready", scan_id=str(scan_id), result_key=result_key)
            except Exception as e:  # noqa: BLE001
                trace = traceback.format_exc()[-4000:]
                log.error(
                    "scan failed",
                    scan_id=str(scan_id),
                    error=str(e),
                    trace=trace,
                )
                await mark_failed(pool, scan_id, f"{type(e).__name__}: {e}\n{trace}")
    finally:
        heartbeat_task.cancel()
        try:
            await heartbeat_task
        except (asyncio.CancelledError, Exception):  # noqa: BLE001
            pass
        await pool.close()


# -----------------------------------------------------------------------------
# Worker registration + heartbeat — direct DB UPSERT, same pattern as the
# claim loop already uses (workers carry the same DB creds).
# -----------------------------------------------------------------------------


def _hwinfo() -> dict:
    """Probe the host for the fields the `workers` table wants. Best-effort:
    anything we can't read becomes None and the admin UI just shows '—'."""
    info = {
        "hostname": socket.gethostname(),
        "os": platform.platform(),
        "arch": platform.machine(),
        "gpu": None,
        "gpu_memory_mb": None,
        "runtime_version": None,
    }
    # GPU name + VRAM from nvidia-smi (lives in the CUDA Docker base image).
    try:
        out = subprocess.run(
            ["nvidia-smi",
             "--query-gpu=name,memory.total",
             "--format=csv,noheader,nounits",
             "-i", "0"],
            check=False, capture_output=True, text=True, timeout=8,
        ).stdout.strip()
        if out:
            # "NVIDIA GeForce RTX 3090, 24576"
            parts = [p.strip() for p in out.splitlines()[0].split(",")]
            if len(parts) >= 1 and parts[0]:
                info["gpu"] = parts[0]
            if len(parts) >= 2:
                try:
                    info["gpu_memory_mb"] = int(parts[1])
                except ValueError:
                    pass
    except Exception:  # noqa: BLE001
        pass
    # CUDA runtime — the env var is set by the nvidia/cuda base image; fall
    # back to nvidia-smi's "CUDA Version" line if it's missing.
    cuda = os.environ.get("CUDA_VERSION")
    if not cuda:
        try:
            out = subprocess.run(
                ["nvidia-smi"], check=False, capture_output=True, text=True, timeout=4,
            ).stdout
            for line in out.splitlines():
                if "CUDA Version" in line:
                    # "Driver Version: 535.86.10    CUDA Version: 12.2"
                    after = line.split("CUDA Version", 1)[1]
                    cuda = after.lstrip(":").strip().split()[0]
                    break
        except Exception:  # noqa: BLE001
            pass
    info["runtime_version"] = f"CUDA {cuda}" if cuda else None
    return info


async def _register_worker(pool: asyncpg.Pool) -> WorkerState:
    """UPSERT on (hostname, kind). Re-running the worker keeps the same row.
    If the admin deleted us in the meantime, this re-creates the row."""
    info = _hwinfo()
    fresh_id = uuid.uuid4()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            INSERT INTO workers (
                id, hostname, kind, os, arch, gpu, gpu_memory_mb,
                runtime_version, worker_version, heartbeat_interval_secs,
                last_seen
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
            ON CONFLICT (hostname, kind) DO UPDATE SET
                os                      = EXCLUDED.os,
                arch                    = EXCLUDED.arch,
                gpu                     = EXCLUDED.gpu,
                gpu_memory_mb           = EXCLUDED.gpu_memory_mb,
                runtime_version         = EXCLUDED.runtime_version,
                worker_version          = EXCLUDED.worker_version,
                heartbeat_interval_secs = EXCLUDED.heartbeat_interval_secs,
                last_seen               = NOW()
            RETURNING id, enabled
            """,
            fresh_id,
            info["hostname"],
            WORKER_KIND,
            info["os"],
            info["arch"],
            info["gpu"],
            info["gpu_memory_mb"],
            info["runtime_version"],
            WORKER_VERSION,
            max(1, HEARTBEAT_INTERVAL),
        )
    return WorkerState(id=row["id"], enabled=row["enabled"])


async def _heartbeat_loop(pool: asyncpg.Pool, state: WorkerState) -> None:
    """Every HEARTBEAT_INTERVAL seconds: bump last_seen, refresh `enabled`.
    If the row vanished (admin delete), re-register so we stay reachable
    instead of silently going stale."""
    while True:
        await asyncio.sleep(HEARTBEAT_INTERVAL)
        try:
            async with pool.acquire() as conn:
                row = await conn.fetchrow(
                    "UPDATE workers SET last_seen = NOW() WHERE id = $1 RETURNING enabled",
                    state.id,
                )
            if row is None:
                log.warning("worker row missing; re-registering", worker_id=str(state.id))
                fresh = await _register_worker(pool)
                state.id = fresh.id
                state.enabled = fresh.enabled
            else:
                state.enabled = row["enabled"]
        except Exception as e:  # noqa: BLE001
            log.warning("heartbeat failed", error=str(e))


# -----------------------------------------------------------------------------
# PG ops
# -----------------------------------------------------------------------------


async def claim_next_pending(pool: asyncpg.Pool, worker_id: Any) -> asyncpg.Record | None:
    async with pool.acquire() as conn:
        return await conn.fetchrow(
            """
            UPDATE scans
               SET state = 'processing', worker_id = $1, claimed_at = now(),
                   finished_at = NULL, attempts = attempts + 1, updated_at = now()
             WHERE id = (
                 SELECT id FROM scans
                  WHERE state = 'pending' AND kind = 'gsplat'
                  ORDER BY created_at ASC
                  FOR UPDATE SKIP LOCKED
                  LIMIT 1
             )
         RETURNING id, storage_prefix, frame_count
            """,
            worker_id,
        )


async def recover_abandoned(pool: asyncpg.Pool, worker_id: Any) -> int:
    """Re-queue scans this worker left in 'processing' — i.e. abandoned when its
    previous incarnation restarted mid-job. Reset to 'pending' so the normal poll
    re-claims them (which bumps `attempts` again). Returns how many were recovered."""
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            UPDATE scans
               SET state = 'pending', worker_id = NULL, claimed_at = NULL,
                   progress = NULL, updated_at = now()
             WHERE worker_id = $1 AND state = 'processing' AND kind = 'gsplat'
         RETURNING id
            """,
            worker_id,
        )
    return len(rows)


async def mark_ready(pool: asyncpg.Pool, scan_id: Any, result_key: str) -> None:
    async with pool.acquire() as conn:
        await conn.execute(
            "UPDATE scans SET state='ready', result_key=$1, progress=100, error_message=NULL, finished_at=now(), updated_at=now() WHERE id=$2",
            result_key,
            scan_id,
        )


async def mark_failed(pool: asyncpg.Pool, scan_id: Any, error: str) -> None:
    async with pool.acquire() as conn:
        await conn.execute(
            "UPDATE scans SET state='failed', error_message=$1, finished_at=now(), updated_at=now() WHERE id=$2",
            error[:8000],
            scan_id,
        )


async def set_progress(pool: asyncpg.Pool, scan_id: Any, pct: int) -> None:
    """Best-effort training progress (0–100); fires the scans NOTIFY trigger."""
    async with pool.acquire() as conn:
        await conn.execute(
            "UPDATE scans SET progress = $1, updated_at = now() WHERE id = $2",
            int(pct),
            scan_id,
        )


# -----------------------------------------------------------------------------
# Pipeline (blocking; called via asyncio.to_thread)
# -----------------------------------------------------------------------------


def process_scan(scan: asyncpg.Record, report=None) -> str:
    """Run the full SfM + training pipeline and return the Garage key of the .ply.

    ``report(pct)`` is an optional best-effort progress callback (0–100) called
    at phase boundaries; the server forwards it to the SPA via the scans NOTIFY
    trigger. Never let a progress hiccup fail the job."""
    scan_id = scan["id"]
    prefix = scan["storage_prefix"]
    # This is the *client*-uploaded frame count — it's 0 for a video-only
    # gsplat scan, where the worker extracts frames from the video itself.
    # The real floor is enforced on `n_frames` after `_prepare_frames`.
    frame_count = scan["frame_count"]

    def progress(pct: int) -> None:
        if report:
            try:
                report(pct)
            except Exception:  # noqa: BLE001
                pass

    progress(8)
    with tempfile.TemporaryDirectory(prefix="gsplat-") as tmp_str:
        tmp = Path(tmp_str)
        # Standard COLMAP layout: <dataset>/images + <dataset>/sparse/0. The two
        # mask sets live OUTSIDE the dataset: colmap_masks/ (COLMAP's mask_path,
        # named "<image>.png") and loss_masks/ (the trainer's, named "<stem>.png").
        dataset = tmp / "dataset"
        images = dataset / "images"
        images.mkdir(parents=True, exist_ok=True)
        colmap_masks_dir = tmp / "colmap_masks"
        loss_masks_dir = tmp / "loss_masks"
        sparse = dataset / "sparse"

        # 1. Get frames into images/ — preferring the scan's original video
        #    (full-res, ffmpeg-sampled) over the client's downscaled WebP set.
        n_frames = _prepare_frames(tmp, prefix, frame_count, images, scan_id)
        if n_frames < MIN_FRAMES:
            raise RuntimeError(f"only {n_frames} usable frames; need >= {MIN_FRAMES}")

        progress(20)
        # 2. Foreground masks (rembg), BEFORE COLMAP. One pass writes two binary
        #    mask sets (the frames stay clean RGB): colmap_masks/ feeds COLMAP's
        #    --ImageReader.mask_path so SfM tracks the figure, not the static
        #    backdrop; loss_masks/ feeds the gsplat trainer so background pixels
        #    contribute zero loss (no Gaussians accrete there → no haze).
        masked = False
        if ENABLE_MASKING:
            masked = _make_masks(images, colmap_masks_dir, loss_masks_dir, scan_id)

        progress(30)
        # 3. COLMAP 4.0.4 SfM from the conda `sfm` env (CUDA build): GPU feature
        #    extraction + sequential matching (COLMAP_USE_GPU, default on), then
        #    the CPU incremental mapper — the macOS 4.0.4 recipe. Keep the largest
        #    sub-model → sparse/0.
        _colmap_sfm(
            images, sparse,
            colmap_masks_dir if masked else None,
            scan_id, n_frames, COLMAP_USE_GPU,
        )

        # 3b. Undistort to a PINHOLE dataset. The trainer rasterises a pinhole
        #     camera and ignores OPENCV distortion, so feeding it the raw
        #     (distorted) frames mis-projects toward the edges (edge floaters +
        #     softness). image_undistorter rewrites images + cameras to pinhole so
        #     the projection matches; falls back to the distorted set on failure.
        train_images, train_sparse = images, sparse / "0"
        if GSPLAT_UNDISTORT:
            undist = tmp / "undistorted"
            try:
                _run("micromamba", "run", "-n", "sfm", "colmap", "image_undistorter",
                     "--image_path", str(images),
                     "--input_path", str(sparse / "0"),
                     "--output_path", str(undist),
                     "--output_type", "COLMAP")
                if (undist / "sparse" / "cameras.bin").exists():
                    train_images, train_sparse = undist / "images", undist / "sparse"
                    log.info("undistorted to pinhole", scan_id=str(scan_id))
                else:
                    log.warning("undistort produced no model; using distorted frames",
                                scan_id=str(scan_id))
            except Exception as e:  # noqa: BLE001
                log.warning("image_undistorter failed; using distorted frames",
                            scan_id=str(scan_id), error=str(e))

        progress(46)
        # 4. Train the Gaussian splat with the CUDA gsplat MCMC trainer
        #    (gsplat_mcmc.py — gsplat is the rasteriser splatfacto already builds
        #    on, so it's in the image and needs no Vulkan). It reads the COLMAP
        #    dataset (images/ + sparse/0) directly, uses loss_masks/ so the
        #    background contributes zero loss, and the MCMC strategy caps the
        #    Gaussian count + relocates dead ones (kills the haze, bounds VRAM).
        #    Runs as a subprocess so its VRAM is released on exit; we stream its
        #    step counter ("<step>/<iters>") into our 46→88 progress band.
        out = tmp / "out"
        out.mkdir()
        ply_path = out / "result.ply"
        step_re = re.compile(rf"(\d+)\s*/\s*{TRAINING_ITERATIONS}\b")
        train_pct = [46]

        def on_train_line(line: str) -> None:
            line = line.rstrip()
            if line:                                    # forward the trainer's stdout to our log so
                log.info(line, scan_id=str(scan_id))    # prune-debug / per-step loss / export show up
            m = step_re.search(line)
            if not m:
                return
            done = min(1.0, int(m.group(1)) / max(1, TRAINING_ITERATIONS))
            overall = 46 + int((88 - 46) * done)
            if overall > train_pct[0]:
                train_pct[0] = overall
                progress(overall)

        train_cmd = [
            "python3", str(GSPLAT_TRAINER),
            "--images", str(train_images),
            "--sparse", str(train_sparse),
            "--output", str(ply_path),
            "--iters", str(TRAINING_ITERATIONS),
            "--cap-max", str(GSPLAT_CAP_MAX),
            "--max-res", str(GSPLAT_MAX_RES),
        ]
        if masked:
            train_cmd += ["--masks", str(loss_masks_dir)]
        _run(*train_cmd, on_line=on_train_line)

        progress(88)
        # 5. The trainer writes result.ply directly.
        if not ply_path.exists():
            raise RuntimeError("gsplat trainer produced no .ply")
        log.info("training finished", scan_id=str(scan_id), ply=str(ply_path),
                 bytes=ply_path.stat().st_size)

        progress(96)
        # 6. Upload result to Garage.
        result_key = f"{prefix}result.ply"
        s3.upload_file(
            str(ply_path),
            S3_BUCKET,
            result_key,
            ExtraArgs={
                "ContentType": "model/ply",
                "CacheControl": "public, max-age=31536000, immutable",
            },
        )
        return result_key


def _prepare_frames(
    tmp: Path, prefix: str, frame_count: int, images: Path, scan_id: Any
) -> int:
    """Populate images/ and return the frame count. Prefers the scan's original
    video (`{prefix}source.*`) — ffmpeg gives full-res, plentiful frames — and
    falls back to the client's downscaled WebP set."""
    video_key = _find_source_video(prefix)
    if video_key:
        local = tmp / f"source{Path(video_key).suffix or '.mp4'}"
        s3.download_file(S3_BUCKET, video_key, str(local))
        n = _extract_video_frames(local, images, scan_id)
        local.unlink(missing_ok=True)
        log.info("frames from video", scan_id=str(scan_id), key=video_key, frames=n)
        return n
    # Decode the WebP frames to PNG: COLMAP and rembg both read PNG reliably,
    # while WebP support is hit-or-miss across OpenCV / PIL versions.
    for i in range(frame_count):
        webp = tmp / f"src_{i:03}.webp"
        s3.download_file(S3_BUCKET, f"{prefix}frame_{i:03}.webp", str(webp))
        with Image.open(webp) as im:
            im.convert("RGB").save(images / f"frame_{i:03}.png")
        webp.unlink(missing_ok=True)
    log.info("frames downloaded", scan_id=str(scan_id), count=frame_count)
    return frame_count


def _find_source_video(prefix: str) -> str | None:
    """Key of an uploaded source video under the prefix, if any."""
    resp = s3.list_objects_v2(Bucket=S3_BUCKET, Prefix=f"{prefix}source.")
    for obj in resp.get("Contents") or []:
        return obj["Key"]
    return None


def _select_sharpest(raw: Path, images: Path, target: int, scan_id: Any) -> int:
    """Keep the sharpest frame (variance-of-Laplacian) per evenly-spaced bucket so
    motion-blurred frames don't soften the splat, while 360° coverage is preserved.
    Falls back to each bucket's middle frame if cv2 is unavailable."""
    frames = sorted(raw.glob("frame_*.png"))
    if not frames:
        return 0
    images.mkdir(parents=True, exist_ok=True)
    sharp = None
    try:
        import cv2  # type: ignore

        def sharp(p: Path) -> float:  # noqa: F811
            g = cv2.imread(str(p), cv2.IMREAD_GRAYSCALE)
            return float(cv2.Laplacian(g, cv2.CV_64F).var()) if g is not None else -1.0
    except Exception:  # noqa: BLE001
        log.warning("cv2 unavailable; bucket-midpoint sampling (no sharpness)",
                    scan_id=str(scan_id))
    total, n = len(frames), 0
    for i in range(target):
        bucket = frames[(i * total) // target:((i + 1) * total) // target]
        if not bucket:
            continue
        best = max(bucket, key=sharp) if sharp is not None else bucket[len(bucket) // 2]
        shutil.copy(str(best), str(images / f"frame_{n:04d}.png"))
        n += 1
    return n


def _extract_video_frames(video: Path, images: Path, scan_id: Any) -> int:
    """Sample PNG frames from the video with ffmpeg, downscaled to VIDEO_MAX_DIM on
    the longest side (never upscaled). Decodes on the GPU (NVDEC) when
    FFMPEG_USE_GPU, falling back to CPU. With FRAME_SHARP_SELECT, oversamples
    (×VIDEO_OVERSAMPLE) then keeps the sharpest frame per bucket (drops motion blur)."""
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=nokey=1:noprint_wrappers=1", str(video)],
        check=False, capture_output=True, text=True,
    )
    try:
        duration = float(probe.stdout.strip())
    except ValueError:
        duration = 0.0
    select = FRAME_SHARP_SELECT
    target = VIDEO_TARGET_FRAMES * VIDEO_OVERSAMPLE if select else VIDEO_TARGET_FRAMES
    fps = (f"fps={max(0.1, target / duration):.5f}" if duration > 0 else "fps=8")
    # Downscale-only to VIDEO_MAX_DIM on the longest side (never upscale).
    scale = (
        f"scale='min({VIDEO_MAX_DIM},iw)':'min({VIDEO_MAX_DIM},ih)'"
        ":force_original_aspect_ratio=decrease"
    )
    out_dir = (images.parent / "_raw_frames") if select else images
    out_dir.mkdir(parents=True, exist_ok=True)
    tail = ["-i", str(video), "-vf", f"{fps},{scale}", str(out_dir / "frame_%04d.png")]
    # GPU decode (NVDEC) first — offloads only the decode (PNG encode stays CPU);
    # falls back to CPU on any failure (a codec/profile NVDEC can't handle, no GPU).
    ran = False
    if FFMPEG_USE_GPU:
        try:
            _run("ffmpeg", "-loglevel", "error", "-hwaccel", "cuda", *tail)
            got = len(list(out_dir.glob("frame_*.png")))
            if got > 0:
                log.info("frames via NVDEC (GPU decode)", scan_id=str(scan_id), frames=got)
                ran = True
            else:
                log.warning("NVDEC produced no frames; retrying on CPU", scan_id=str(scan_id))
        except Exception as e:  # noqa: BLE001
            log.warning("NVDEC decode failed; falling back to CPU",
                        scan_id=str(scan_id), error=str(e))
        if not ran:
            for f in out_dir.glob("frame_*.png"):  # clear partial output before retry
                f.unlink(missing_ok=True)
    if not ran:
        _run("ffmpeg", "-loglevel", "error", *tail)
    if not select:
        return len(list(out_dir.glob("frame_*.png")))
    raw_n = len(list(out_dir.glob("frame_*.png")))
    n = _select_sharpest(out_dir, images, VIDEO_TARGET_FRAMES, scan_id)
    shutil.rmtree(out_dir, ignore_errors=True)
    log.info("sharpest-frame selection", scan_id=str(scan_id), oversampled=raw_n, kept=n)
    return n


def _make_masks(images: Path, colmap_masks_dir: Path, loss_masks_dir: Path,
                scan_id: Any) -> bool:
    """Segment the figure with rembg (one pass) and write TWO binary mask sets
    from the same cutout — the frames themselves stay clean RGB:

      * COLMAP ``mask_path`` masks at colmap_masks/<image>.png (0 = ignore,
        255 = use), so feature extraction skips the static turntable backdrop and
        SfM tracks the figure (essential on a turntable, or it registers almost
        nothing). COLMAP's convention is the image name + ".png".
      * Per-frame loss masks at loss_masks/<stem>.png for the gsplat trainer:
        background pixels contribute zero loss, so no Gaussians accrete in the
        background — the haze fix, together with MCMC relocation.

    Runs rembg on the GPU; if that fails (e.g. a CUDA OOM — heavier models don't
    fit a 6 GB card), it RETRIES on CPU so a turntable is never silently left
    unmasked (which wrecks SfM and leaves haze). Best-effort: returns False only if
    CPU also fails. The session is freed before COLMAP / training claim the card."""
    try:
        from rembg import new_session, remove  # type: ignore
    except Exception:  # noqa: BLE001
        log.warning("masking on but rembg unavailable; running unmasked", scan_id=str(scan_id))
        return False
    colmap_masks_dir.mkdir(parents=True, exist_ok=True)
    loss_masks_dir.mkdir(parents=True, exist_ok=True)

    def _segment(providers) -> int:
        session = new_session(REMBG_MODEL, providers=providers)
        try:
            active = session.inner_session.get_providers()
        except Exception:  # noqa: BLE001
            active = []
        log.info("rembg session", scan_id=str(scan_id), model=REMBG_MODEL,
                 providers=active, gpu="CUDAExecutionProvider" in active)
        n = 0
        for img in sorted(images.glob("*.png")):
            with Image.open(img) as im:
                cut = remove(im.convert("RGBA"), session=session)
            # Binary foreground mask from the cutout's alpha (0 = bg, 255 = fg).
            mask = cut.split()[-1].point(lambda a: 255 if a > 10 else 0).convert("L")
            mask.save(colmap_masks_dir / f"{img.name}.png")   # COLMAP: "<image>.png"
            mask.save(loss_masks_dir / f"{img.stem}.png")     # trainer: "<stem>.png"
            n += 1
        del session
        gc.collect()
        return n

    # GPU first; fall back to CPU (slower, but no VRAM ceiling) on any failure.
    attempts = [["CUDAExecutionProvider", "CPUExecutionProvider"], ["CPUExecutionProvider"]]
    for i, providers in enumerate(attempts):
        try:
            n = _segment(providers)
            log.info("masks generated", scan_id=str(scan_id), count=n)
            return n > 0
        except Exception as e:  # noqa: BLE001 — masking must never fail the job
            gc.collect()
            for d in (colmap_masks_dir, loss_masks_dir):  # drop partial output before retry
                for f in d.glob("*.png"):
                    f.unlink(missing_ok=True)
            if i + 1 < len(attempts):
                log.warning("rembg failed on GPU (CUDA OOM?); retrying on CPU",
                            scan_id=str(scan_id), error=str(e))
            else:
                log.warning("masking failed on GPU and CPU; running unmasked",
                            scan_id=str(scan_id), error=str(e))
    return False


def _colmap_sfm(images: Path, sparse: Path, mask_dir: Path | None,
                scan_id: Any, frame_count: int, use_gpu: bool) -> None:
    """Full COLMAP **4.0.4** Structure-from-Motion from the conda `sfm` env (a
    CUDA build), keeping the largest sub-model. Same COLMAP version as the macOS
    worker (Homebrew ships 4.0.4) and the same flags — COLMAP 4.0's reworked
    incremental mapper is what makes turntables reconstruct reliably. Pinned
    explicitly because conda-forge's `=cpu*` glob silently resolves to 3.11.1,
    not 4.x (Dockerfile).

    Feature extraction + matching run on the GPU when ``use_gpu`` (default), else
    CPU. COLMAP 4.0 renamed the toggles to FeatureExtraction.* / FeatureMatching.*
    (max_num_features etc. kept the SiftExtraction.* name). Caveat worth knowing:
    COLMAP's CUDA SIFT extraction is non-deterministic (GPU float atomics) — if a
    glossy turntable flaps between a full model and a 2-frame stub, set
    COLMAP_USE_GPU=false (the macOS worker extracts on CPU for exactly this
    reason). The mapper is CPU/Ceres regardless. Extraction is tuned for the hard
    case (many weak SIFT features) + `mask_path` so SfM tracks the figure, not the
    static backdrop; sequential matching keeps correspondences local (exhaustive
    invites false matches between look-alike angles → the confetti ball)."""
    sparse.mkdir(parents=True, exist_ok=True)
    db = sparse.parent / "colmap.db"
    colmap = ["micromamba", "run", "-n", "sfm", "colmap"]
    gpu = "1" if use_gpu else "0"

    # Feature extraction + matching, factored so an ALIKED failure FALLS BACK to
    # SIFT instead of wasting the whole scan. ALIKED (learned) features + LightGlue
    # give better poses on glossy/low-texture surfaces; their ONNX models are baked
    # into the image (the read-only container can't fetch them at runtime). The
    # COLMAP enum is `ALIKED_N16ROT` (rotation-invariant — good for a turntable).
    def _extract_match(use_aliked: bool) -> None:
        extract = [
            *colmap, "feature_extractor",
            "--database_path", str(db),
            "--image_path", str(images),
            "--ImageReader.single_camera", "1",
            "--ImageReader.camera_model", "OPENCV",
            "--FeatureExtraction.use_gpu", gpu,
        ]
        if use_aliked:
            extract += [
                "--FeatureExtraction.type", "ALIKED_N16ROT",
                "--AlikedExtraction.max_num_features", str(ALIKED_MAX_FEATURES),
                "--AlikedExtraction.n16rot_model_path",
                str(Path(COLMAP_MODELS_DIR) / "aliked-n16rot.onnx"),
            ]
        else:
            extract += [
                "--SiftExtraction.max_num_features", str(COLMAP_MAX_FEATURES),
                "--SiftExtraction.peak_threshold", "0.004",
                "--SiftExtraction.edge_threshold", "16",
            ]
        if mask_dir is not None:
            extract += ["--ImageReader.mask_path", str(mask_dir)]
        _run(*extract)

        # Sequential matching (ordered frames + a window): on a turntable, EXHAUSTIVE
        # tempts SfM with false matches between look-alike opposite angles (the
        # confetti ball). ALIKED features pair with the ALIKED+LightGlue matcher.
        mtype = (["--FeatureMatching.type", "ALIKED_LIGHTGLUE",
                  "--AlikedMatching.lightglue_model_path",
                  str(Path(COLMAP_MODELS_DIR) / "aliked-lightglue.onnx")] if use_aliked else [])
        if frame_count >= 60:
            matcher = [*colmap, "sequential_matcher", "--database_path", str(db),
                       "--FeatureMatching.use_gpu", gpu, *mtype,
                       "--SequentialMatching.overlap", "20"]
        else:
            matcher = [*colmap, "exhaustive_matcher", "--database_path", str(db),
                       "--FeatureMatching.use_gpu", gpu, *mtype]
        _run(*matcher)

    if SFM_FEATURES == "aliked":
        try:
            _extract_match(True)
        except RuntimeError as e:
            log.warning("ALIKED SfM failed; falling back to SIFT",
                        scan_id=str(scan_id), error=str(e))
            db.unlink(missing_ok=True)   # clear partial ALIKED db before the SIFT retry
            _extract_match(False)
    else:
        _extract_match(False)

    # Incremental mapping — same COLMAP 4.0.4. Lenient registration thresholds
    # admit more of the marginal turntable views. Bundle adjustment is CPU/Ceres
    # unless COLMAP_BA_USE_GPU (rarely worth it at ~150 frames — see the constant).
    if SFM_MAPPER == "global":
        # GLOMAP global SfM (COLMAP 4.0 built-in) — estimates ALL poses at once
        # (rotation averaging + global positioning + one final BA) instead of the
        # incremental per-image loop, so the dense ALIKED+LightGlue matches that
        # choke the incremental mapper for HOURS finish in minutes. Drop-in: writes a
        # standard model to sparse/0. Two robustness steps for a dense single-object
        # graph: refine the shared intrinsics from the view graph first (best-effort),
        # and — only if global positioning collapses to a degenerate "cube" — thin the
        # track set. NB COLMAP's global_mapper has NO max-tracks cap (the standalone
        # GLOMAP `TrackEstablishment.max_num_tracks` is rejected); the exposed lever is
        # the MINIMUM VIEWS PER TRACK (keep only well-supported tracks → fewer tracks).
        try:
            _run(*colmap, "view_graph_calibrator", "--database_path", str(db))
        except RuntimeError as e:  # best-effort — global_mapper self-calibrates otherwise
            log.warning("view_graph_calibrator failed; continuing",
                        scan_id=str(scan_id), error=str(e))
        mapper = [*colmap, "global_mapper",
                  "--database_path", str(db),
                  "--image_path", str(images),
                  "--output_path", str(sparse)]
        if GLOMAP_MIN_VIEWS_PER_TRACK > 0:   # fewer, better-supported tracks → avoids the "cube"
            mapper += ["--GlobalMapper.track_min_num_views_per_track",
                       str(GLOMAP_MIN_VIEWS_PER_TRACK)]
        _run(*mapper)
    else:
        mapper = [
            *colmap, "mapper",
            "--database_path", str(db),
            "--image_path", str(images),
            "--output_path", str(sparse),
            "--Mapper.init_min_num_inliers", "50",
            "--Mapper.abs_pose_min_num_inliers", "20",
        ]
        if COLMAP_BA_USE_GPU:
            mapper += ["--Mapper.ba_use_gpu", "1"]
        _run(*mapper)

    # COLMAP can split a hard scene into several sub-models (sparse/0, sparse/1,
    # …); keep the one with the most registered images, collapsed to sparse/0
    # (the standard COLMAP path the trainer reads).
    comps = [
        (d, _count_registered(d))
        for d in sparse.iterdir()
        if d.is_dir() and (d / "images.bin").exists()
    ]
    comps.sort(key=lambda c: c[1], reverse=True)
    best_n = comps[0][1] if comps else 0
    log.info("colmap components", scan_id=str(scan_id),
             components={d.name: n for d, n in comps}, registered=best_n,
             total=frame_count)
    if best_n < MIN_REGISTERED:
        raise RuntimeError(
            f"COLMAP registered only {best_n}/{frame_count} frames — too few for a "
            f"usable splat (needs >= {MIN_REGISTERED}). Likely a capture/SfM issue: "
            f"a glossy or low-texture figure, too-fast rotation, or a busy "
            f"background. Try a slower, steadier turntable and even, diffuse lighting."
        )
    # Collapse the best sub-model to sparse/0.
    keep = sparse / "__best__"
    shutil.move(str(comps[0][0]), str(keep))
    for d in list(sparse.iterdir()):
        if d.is_dir() and d.name != "__best__":
            shutil.rmtree(d, ignore_errors=True)
    shutil.move(str(keep), str(sparse / "0"))
    log.info("colmap best model kept", scan_id=str(scan_id),
             registered=best_n, total=frame_count)


def _count_registered(model_dir: Path) -> int:
    """Registered-image count of a COLMAP model (the images.bin header's first u64
    is the image count; fall back to parsing images.txt)."""
    b = model_dir / "images.bin"
    if b.exists():
        with open(b, "rb") as fh:
            head = fh.read(8)
        return struct.unpack("<Q", head)[0] if len(head) == 8 else 0
    t = model_dir / "images.txt"
    if t.exists():
        for line in t.read_text().splitlines():
            if line.startswith("# Number of images:"):
                try:
                    return int(line.split(":")[1].split(",")[0])
                except ValueError:
                    return 0
    return 0


def _run(*cmd: str, on_line=None) -> None:
    """Run `cmd`, streaming its combined stdout+stderr line by line. This lets us
    (a) keep only a bounded tail for the error message instead of buffering a
    whole training run in memory, and (b) feed each line to an optional
    `on_line(line)` hook for live progress. Raises RuntimeError with the tail on
    a non-zero exit. `on_line` is best-effort — an exception in it never breaks
    the run."""
    log.info("running", cmd=" ".join(cmd))
    # stderr→stdout so progress + errors stream in order; text mode's universal
    # newlines also splits on `\r`, so a carriage-return-refreshed progress line
    # is yielded as its own line.
    proc = subprocess.Popen(
        cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1
    )
    tail = deque(maxlen=400)
    assert proc.stdout is not None
    for line in proc.stdout:
        tail.append(line)
        if on_line is not None:
            try:
                on_line(line)
            except Exception:  # noqa: BLE001 — progress parsing must never break the run
                pass
    proc.wait()
    if proc.returncode != 0:
        msg = (
            f"{' '.join(cmd)} exited {proc.returncode}\n"
            f"--- output (tail) ---\n{''.join(tail)}"
        )
        raise RuntimeError(msg)


# -----------------------------------------------------------------------------

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass

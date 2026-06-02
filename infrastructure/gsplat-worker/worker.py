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
    TRAINING_ITERATIONS   optional, splatfacto max-num-iterations (default 30000)
    VIDEO_TARGET_FRAMES   optional, frames sampled from a source video (default 150)
    VIDEO_MAX_DIM         optional, max-dim cap on extracted frames (default 2048)
    ENABLE_MASKING        optional, rembg-mask the figure (default true) — fed to
                          COLMAP's mask_path so SfM tracks the figure not the
                          backdrop, and to splatfacto's loss to drop the bg
    COLMAP_USE_GPU        optional, run COLMAP feature extraction on the GPU via
                          its CUDA path (default true); set false to force CPU
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
# Background masking. On by default — this is an object scanner, so the figure
# should be isolated from whatever it sits on. When on, rembg masks each frame
# (before COLMAP) and we feed them BOTH to COLMAP's mask_path (so SfM ignores the
# static turntable backdrop — essential, or it registers almost nothing) AND to
# splatfacto's loss via the colmap dataparser (so the background never accretes
# gaussians). Best-effort: if rembg is missing or errors, COLMAP and training
# run unmasked.
ENABLE_MASKING = os.environ.get("ENABLE_MASKING", "true").lower() in ("1", "true", "yes")
# Run COLMAP feature extraction + matching on the GPU. This image ships a
# CUDA-built COLMAP, which selects its CUDA SIFT automatically on a headless host
# (no OpenGL, no display) — so GPU mode "just works". Set COLMAP_USE_GPU=false to
# force CPU (passes --Sift*.use_gpu 0). Either way the COLMAP mapper / bundle-
# adjustment stays on CPU (incompressible).
COLMAP_USE_GPU = os.environ.get("COLMAP_USE_GPU", "true").lower() in ("1", "true", "yes")

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
WORKER_VERSION = "0.1.0"

MIN_FRAMES = 6
# COLMAP must register at least this many frames for a non-degenerate sparse
# model. Fewer (e.g. a turntable COLMAP couldn't solve) yields a near-empty
# point cloud → ~0 gaussians → splatfacto dies deep in CUDA ("invalid
# configuration argument" from a zero-config kernel launch). Fail clean instead.
MIN_REGISTERED = 10

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
    """Boot-time GPU self-test. Logs the CUDA device torch sees and what
    nvidia-smi reports — i.e. the GPU that runs COLMAP's CUDA SIFT (feature
    extraction + matching) AND trains the splat (`ns-train splatfacto`). If CUDA
    is missing here, COLMAP_USE_GPU=true won't help and training would crawl."""
    # (1) CUDA compute — the splat-training path (the GPU work that matters).
    try:
        import torch  # local import: heavy, only needed for the probe
        if torch.cuda.is_available():
            devs = []
            for i in range(torch.cuda.device_count()):
                p = torch.cuda.get_device_properties(i)
                devs.append(f"{p.name} ({p.total_memory // (1024 * 1024)} MiB)")
            log.info("gpu: CUDA available (used by splat training)",
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
        log.warning("gpu: nvidia-smi unavailable (graphics/compute not exposed?)", error=str(e))

    # (3) Which COLMAP feature path will run this boot.
    log.info(
        "gpu: COLMAP feature extraction",
        mode="CUDA (GPU)" if COLMAP_USE_GPU else "CPU (--no-gpu)",
    )


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
        images = tmp / "images"
        images.mkdir()

        # 1. Get frames into images/ — preferring the scan's original video
        #    (full-res, ffmpeg-sampled) over the client's downscaled WebP set.
        n_frames = _prepare_frames(tmp, prefix, frame_count, images, scan_id)
        if n_frames < MIN_FRAMES:
            raise RuntimeError(f"only {n_frames} usable frames; need >= {MIN_FRAMES}")

        progress(20)
        # Lay out a COLMAP dataset under tmp/: images/ (SfM input + training),
        # colmap/sparse/0 (the model), masks/ (nerfstudio loss masks),
        # colmap_masks/ (COLMAP's mask_path). The `colmap` dataparser reads
        # images/ + colmap/sparse/0 (+ masks/) directly — no transforms.json.
        masks_dir = tmp / "masks"
        colmap_masks_dir = tmp / "colmap_masks"
        sparse = tmp / "colmap" / "sparse"

        # 2. Foreground masks (rembg) — ONE pass, BEFORE COLMAP, in both
        #    conventions: COLMAP's mask_path (so SfM ignores the static turntable
        #    backdrop and tracks the rotating figure) and nerfstudio's per-frame
        #    loss masks (so splatfacto never fits the background). Same binary
        #    mask, two filenames. We run COLMAP ourselves, so frames are never
        #    renamed and masks stay aligned by name throughout.
        masked = False
        if ENABLE_MASKING:
            masked = _make_masks(images, masks_dir, colmap_masks_dir, scan_id)

        progress(30)
        # 3. COLMAP SfM, ported from the macOS worker and tuned for the hard case
        #    (glossy / low-texture figures on a single-ring turntable): many weak
        #    SIFT features, sequential matching on the ordered video frames, a
        #    lenient mapper, then keep the largest registered sub-model. ns-process
        #    -data's stock COLMAP managed only 2/100 here (and took 38 min — the
        #    wrong matcher). Raises an actionable error if too few frames register.
        _colmap_sfm(
            images, sparse,
            colmap_masks_dir if masked else None,
            scan_id, n_frames, COLMAP_USE_GPU,
        )

        progress(46)
        # 4. Train splatfacto on the COLMAP model via the `colmap` dataparser
        #    (reads images/ + colmap/sparse/0 + masks/ directly). `--vis
        #    tensorboard` is the documented headless choice. nerfstudio's local
        #    writer prints per-step "1010 (6.73%)" lines; `_run` streams them and
        #    we map training 0→100% into our 46→88 band so the bar climbs the
        #    whole time instead of sitting at 46.
        trained = tmp / "trained"
        step_re = re.compile(r"(\d+)\s*\(\s*\d{1,3}(?:\.\d+)?\s*%\s*\)")
        train_pct = [46]

        def on_train_line(line: str) -> None:
            m = step_re.search(line)
            if not m:
                return
            step = int(m.group(1))
            done = min(1.0, step / max(1, TRAINING_ITERATIONS))
            overall = 46 + int((88 - 46) * done)
            if overall > train_pct[0]:
                train_pct[0] = overall
                progress(overall)

        train_cmd = [
            "ns-train", "splatfacto",
            "--data", str(tmp),
            "--output-dir", str(trained),
            "--max-num-iterations", str(TRAINING_ITERATIONS),
            # Penalise long, spikey gaussians (PhysGaussian scale regulariser,
            # max_gauss_ratio=10) — nerfstudio's documented fix for the
            # needle/starburst artifact. Off by default upstream.
            "--pipeline.model.use-scale-regularization", "True",
            "--vis", "tensorboard",
            # `colmap` dataparser: read the COLMAP model + images directly.
            "colmap",
            "--images-path", "images",
            "--colmap-path", "colmap/sparse/0",
        ]
        if masked:
            # Per-frame loss masks (0 = ignore) → splatfacto skips the background.
            train_cmd += ["--masks-path", "masks"]
        _run(*train_cmd, on_line=on_train_line)

        progress(88)
        # 5. Find the config.yml the trainer produced.
        configs = sorted(trained.rglob("config.yml"))
        if not configs:
            raise RuntimeError("ns-train produced no config.yml")
        config_path = configs[-1]
        log.info("training finished", scan_id=str(scan_id), config=str(config_path))

        # 6. Export the Gaussian Splat to .ply.
        export_dir = tmp / "export"
        _run(
            "ns-export", "gaussian-splat",
            "--load-config", str(config_path),
            "--output-dir", str(export_dir),
        )
        plys = list(export_dir.glob("*.ply"))
        if not plys:
            raise RuntimeError("ns-export produced no .ply")
        ply_path = plys[0]
        size = ply_path.stat().st_size
        log.info("export finished", scan_id=str(scan_id), bytes=size)

        progress(96)
        # 7. Upload result to Garage.
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
    # while WebP support is hit-or-miss across the OpenCV / PIL versions
    # Nerfstudio drags in.
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


def _extract_video_frames(video: Path, images: Path, scan_id: Any) -> int:
    """Sample ~VIDEO_TARGET_FRAMES evenly-spaced PNG frames from the video with
    ffmpeg, downscaled to VIDEO_MAX_DIM on the longest side (never upscaled)."""
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=nokey=1:noprint_wrappers=1", str(video)],
        check=False, capture_output=True, text=True,
    )
    try:
        duration = float(probe.stdout.strip())
    except ValueError:
        duration = 0.0
    fps = (
        f"fps={max(0.1, VIDEO_TARGET_FRAMES / duration):.5f}"
        if duration > 0
        else "fps=8"
    )
    # Downscale-only to VIDEO_MAX_DIM on the longest side (never upscale).
    scale = (
        f"scale='min({VIDEO_MAX_DIM},iw)':'min({VIDEO_MAX_DIM},ih)'"
        ":force_original_aspect_ratio=decrease"
    )
    _run(
        "ffmpeg", "-loglevel", "error", "-i", str(video),
        "-vf", f"{fps},{scale}", str(images / "frame_%04d.png"),
    )
    return len(list(images.glob("frame_*.png")))


def _make_masks(images: Path, masks_dir: Path, colmap_masks_dir: Path, scan_id: Any) -> bool:
    """Segment the figure with rembg and write masks in BOTH conventions, BEFORE
    COLMAP runs:

      * ``colmap_masks/<image>.png`` — COLMAP's ``--ImageReader.mask_path`` form
        (0 = ignore). With it SfM extracts no features in the static turntable
        backdrop and tracks the rotating figure instead.
      * ``masks/<stem>.png`` — nerfstudio's per-frame mask (0 = ignore), which the
        ``colmap`` dataparser feeds to splatfacto's loss so the background never
        accretes gaussians.

    Same binary mask (white = figure); only the filename differs (COLMAP appends
    .png to the full image name; nerfstudio uses the stem). We run COLMAP
    ourselves so frames keep their names and masks align throughout. GPU rembg;
    the session is freed before COLMAP/ns-train claim the card. Best-effort:
    returns False (COLMAP + training run unmasked) on any failure."""
    try:
        from rembg import new_session, remove  # type: ignore
    except Exception:  # noqa: BLE001
        log.warning("masking on but rembg unavailable; running unmasked", scan_id=str(scan_id))
        return False
    try:
        masks_dir.mkdir(parents=True, exist_ok=True)
        colmap_masks_dir.mkdir(parents=True, exist_ok=True)
        session = new_session(
            "u2net", providers=["CUDAExecutionProvider", "CPUExecutionProvider"]
        )
        try:
            active = session.inner_session.get_providers()
        except Exception:  # noqa: BLE001
            active = []
        log.info("rembg session", scan_id=str(scan_id), providers=active,
                 gpu="CUDAExecutionProvider" in active)
        n = 0
        for img in sorted(images.glob("*.png")):
            with Image.open(img) as im:
                cut = remove(im.convert("RGBA"), session=session)
            mask = cut.split()[-1].point(lambda a: 255 if a > 10 else 0).convert("L")
            mask.save(masks_dir / f"{img.stem}.png")          # nerfstudio: <stem>.png
            mask.save(colmap_masks_dir / f"{img.name}.png")   # COLMAP: <image>.png
            n += 1
        del session
        gc.collect()
        log.info("masks generated", scan_id=str(scan_id), count=n)
        return n > 0
    except Exception as e:  # noqa: BLE001 — masking must never fail the job
        log.warning("masking failed; running unmasked", scan_id=str(scan_id), error=str(e))
        return False


def _colmap_sfm(images: Path, sparse: Path, mask_dir: Path | None,
                scan_id: Any, frame_count: int, use_gpu: bool) -> None:
    """COLMAP feature extraction + matching + mapping, then keep the best
    sub-model. Ported from the macOS worker and tuned for the hard case (glossy,
    low-texture figures on a single-ring turntable): many weak SIFT features, a
    lenient mapper, sequential matching on the ordered video frames.

    Flag note for the base image's COLMAP 3.9.1: the GPU toggle there is
    ``SiftExtraction/SiftMatching.use_gpu`` (4.x renamed it to FeatureExtraction).
    We only pass it to FORCE CPU — by default COLMAP uses the GPU, and the
    CUDA-built COLMAP picks CUDA SIFT headlessly, so the default path carries no
    version-sensitive flag. The SIFT/Mapper tuning options are stable across
    versions."""
    sparse.mkdir(parents=True, exist_ok=True)
    db = sparse.parent / "colmap.db"

    extract = [
        "colmap", "feature_extractor",
        "--database_path", str(db),
        "--image_path", str(images),
        "--ImageReader.single_camera", "1",
        "--ImageReader.camera_model", "OPENCV",
        "--SiftExtraction.max_num_features", "16384",
        "--SiftExtraction.peak_threshold", "0.004",
        "--SiftExtraction.edge_threshold", "16",
    ]
    if mask_dir is not None:
        extract += ["--ImageReader.mask_path", str(mask_dir)]
    if not use_gpu:
        extract += ["--SiftExtraction.use_gpu", "0"]
    _run(*extract)

    # Exhaustive matching is O(n²) and crawls (38 min via ns-process-data); these
    # are ORDERED video frames, so sequential matching (consecutive frames + a
    # window) is both far faster and better-conditioned for a turntable.
    if frame_count >= 60:
        matcher = [
            "colmap", "sequential_matcher",
            "--database_path", str(db),
            "--SequentialMatching.overlap", "20",
        ]
    else:
        matcher = ["colmap", "exhaustive_matcher", "--database_path", str(db)]
    if not use_gpu:
        matcher += ["--SiftMatching.use_gpu", "0"]
    _run(*matcher)

    # Lenient registration — turntable SfM is marginal; admit more views.
    _run(
        "colmap", "mapper",
        "--database_path", str(db),
        "--image_path", str(images),
        "--output_path", str(sparse),
        "--Mapper.init_min_num_inliers", "50",
        "--Mapper.abs_pose_min_num_inliers", "20",
    )
    _select_largest_model(sparse, scan_id, frame_count)


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


def _select_largest_model(sparse: Path, scan_id: Any, frame_count: int) -> None:
    """COLMAP splits a hard scene into several disconnected reconstructions
    (sparse/0, sparse/1, …). Keep ONLY the one with the most registered images,
    collapsed to sparse/0, so splatfacto trains on the best model. Raise with an
    actionable message if even the best is too small — instead of letting
    splatfacto crash in CUDA on a near-empty point cloud."""
    comps = [
        (d, _count_registered(d))
        for d in sparse.iterdir()
        if d.is_dir() and (d / "images.bin").exists()
    ]
    if not comps:
        raise RuntimeError(
            "COLMAP produced no sparse model — Structure-from-Motion failed to "
            "register the frames. Glossy / low-texture figures on a single-ring "
            "turntable are very hard for SfM; try a slower, steadier turntable, "
            "even diffuse lighting, and a matte (less reflective) figure."
        )
    comps.sort(key=lambda c: c[1], reverse=True)
    best, best_n = comps[0]
    log.info("colmap components", scan_id=str(scan_id),
             components={d.name: n for d, n in comps}, best=best.name,
             registered=best_n, total=frame_count)
    if best_n < MIN_REGISTERED:
        raise RuntimeError(
            f"COLMAP registered only {best_n}/{frame_count} frames — too few for a "
            f"usable splat (needs >= {MIN_REGISTERED}). Usually a capture/SfM issue: "
            f"a glossy or low-texture figure, too-fast rotation, or a busy "
            f"background. Try a slower, steadier turntable and even, diffuse lighting."
        )
    keep = sparse / "__keep__"
    shutil.move(str(best), str(keep))
    for d in list(sparse.iterdir()):
        if d.is_dir() and d != keep:
            shutil.rmtree(d, ignore_errors=True)
    shutil.move(str(keep), str(sparse / "0"))


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

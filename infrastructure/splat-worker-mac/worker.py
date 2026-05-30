"""
FigureCollector — native macOS Gaussian Splatting worker (Brush + COLMAP).

Same job and the SAME database / Garage / ``result.ply`` contract as the CUDA
``gsplat-worker``, but it runs **natively on macOS** so it can use the Apple
GPU through Metal (Brush is built on wgpu → Metal). It deliberately does *not*
run in Docker: Docker Desktop on macOS cannot pass the Metal GPU into a Linux
container, so a containerised worker here would be CPU-only.

Because it runs on the host (outside the compose network), point it at the
*published* stack ports — Postgres on ``localhost:8432`` and Garage on
``localhost:3902`` by default.

Pipeline:
  1. Claim the oldest ``state='pending' AND kind='gsplat'`` scan
     (``FOR UPDATE SKIP LOCKED``) — identical to the CUDA worker.
  2. Download every frame from Garage (same ``{prefix}frame_{i:03}.webp`` keys).
  3. Decode the WebP frames to PNG (COLMAP/Brush read PNG reliably; WebP is
     hit-or-miss). Optionally background-mask the object (see ENABLE_MASKING) —
     turntable shots have a *static* background that wrecks Structure-from-Motion,
     and masking is what turns garbage into a usable splat.
  4. COLMAP Structure-from-Motion on the CPU → camera poses + sparse points
     laid out as a standard COLMAP dataset (``images/`` + ``sparse/0/``).
  5. Brush trains a Gaussian Splat on the Metal GPU and exports ``result.ply``.
  6. Upload the ``.ply`` to Garage at ``{prefix}result.ply`` and flip the scan
     to ``state='ready'`` — which is exactly what ``/api/scans/{id}/splat`` and
     the front-end ``GsplatViewer`` already expect.

Environment — see ``.env.example``.
"""

from __future__ import annotations

import asyncio
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

DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "postgres://figurecollector:figurecollector_dev@localhost:8432/figurecollector",
)
S3_ENDPOINT = os.environ.get("S3_ENDPOINT", "http://localhost:3902")
S3_BUCKET = os.environ.get("S3_BUCKET", "figurecollector")
S3_ACCESS_KEY = os.environ["S3_ACCESS_KEY"]
S3_SECRET_KEY = os.environ["S3_SECRET_KEY"]
S3_REGION = os.environ.get("S3_REGION", "garage")
POLL_INTERVAL = int(os.environ.get("POLL_INTERVAL", "10"))
TRAINING_ITERATIONS = int(os.environ.get("TRAINING_ITERATIONS", "15000"))
# When a scan ships its original video (key `{prefix}source.*`), we extract our
# own frames from it with ffmpeg — far more of them, and from a lossless source,
# than the downscaled WebP set the client uploads for the 360° viewer.
VIDEO_TARGET_FRAMES = int(os.environ.get("VIDEO_TARGET_FRAMES", "150"))
# Cap the longest side of extracted frames. 4K is overkill for SfM + Gaussian
# splatting and makes COLMAP matching / training crawl; ~2048 px is the sweet
# spot (well above the client's 1920 px WebP, still fast). Raise if you must.
VIDEO_MAX_DIM = int(os.environ.get("VIDEO_MAX_DIM", "2048"))

# Tooling — the Brush binary we build from source, and COLMAP from Homebrew.
BRUSH_BIN = os.environ.get(
    "BRUSH_BIN", str(Path.home() / ".cache" / "fc-brush" / "target" / "release" / "brush")
)
COLMAP_BIN = os.environ.get("COLMAP_BIN", "colmap")
# Background masking. Off by default (keeps the dependency footprint small); flip
# it on for turntable captures, where it makes a night-and-day quality difference.
ENABLE_MASKING = os.environ.get("ENABLE_MASKING", "false").lower() in ("1", "true", "yes")

# Worker registration. The backend's offline detector waits 3 × this interval
# (per `domain::worker::OFFLINE_MISS_THRESHOLD`) before flagging us offline,
# so 30s here ≈ 90s of grace before the admin UI marks us hors-ligne.
HEARTBEAT_INTERVAL = int(os.environ.get("HEARTBEAT_INTERVAL", "30"))
WORKER_KIND = "metal"
WORKER_VERSION = "0.1.0"

MIN_FRAMES = 6

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


async def main() -> None:
    _preflight()
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
        brush=BRUSH_BIN,
        masking=ENABLE_MASKING,
    )
    heartbeat_task = asyncio.create_task(_heartbeat_loop(pool, state))
    try:
        while True:
            # Admin can flip `enabled` off at any moment; the heartbeat
            # refreshes it. Idle politely instead of claiming.
            if not state.enabled:
                await asyncio.sleep(POLL_INTERVAL)
                continue
            scan = await claim_next_pending(pool)
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
                log.error("scan failed", scan_id=str(scan_id), error=str(e), trace=trace)
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
        "os": f"macOS {platform.mac_ver()[0]}".strip() or platform.platform(),
        "arch": platform.machine(),
        "gpu": None,
        "gpu_memory_mb": None,
        "runtime_version": None,
    }
    # GPU model — system_profiler is the canonical macOS path.
    try:
        out = subprocess.run(
            ["system_profiler", "SPDisplaysDataType"],
            check=False, capture_output=True, text=True, timeout=8,
        ).stdout
        # "Chipset Model: Apple M1 Pro" — first match wins (integrated GPU).
        m = re.search(r"Chipset Model:\s*(.+)", out)
        if m:
            info["gpu"] = m.group(1).strip()
        # On Apple Silicon, "Total Number of Cores" appears under the GPU
        # block but VRAM is shared with system RAM. Report unified-memory
        # size when we can find it; admins recognise the "unified" suffix.
        mm = re.search(r"VRAM \(Total\):\s*(\d+)\s*GB", out)
        if mm:
            info["gpu_memory_mb"] = int(mm.group(1)) * 1024
    except Exception:  # noqa: BLE001
        pass
    # Runtime — Brush is wgpu→Metal; tag the macOS major as a proxy for the
    # Metal version (Metal 3 lives in macOS 13+, etc.).
    info["runtime_version"] = f"Metal via wgpu (macOS {platform.mac_ver()[0]})"
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


def _preflight() -> None:
    """Fail fast with a clear message if the local tooling is missing."""
    if not Path(BRUSH_BIN).exists():
        raise SystemExit(
            f"Brush binary not found at {BRUSH_BIN}. Build it first "
            f"(see README) or set BRUSH_BIN."
        )
    if shutil.which(COLMAP_BIN) is None:
        raise SystemExit(
            f"COLMAP not found ({COLMAP_BIN}). `brew install colmap` or set COLMAP_BIN."
        )


# -----------------------------------------------------------------------------
# PG ops — identical contract to the CUDA worker.
# -----------------------------------------------------------------------------


async def claim_next_pending(pool: asyncpg.Pool) -> asyncpg.Record | None:
    async with pool.acquire() as conn:
        return await conn.fetchrow(
            """
            UPDATE scans
               SET state = 'processing', updated_at = now()
             WHERE id = (
                 SELECT id FROM scans
                  WHERE state = 'pending' AND kind = 'gsplat'
                  ORDER BY created_at ASC
                  FOR UPDATE SKIP LOCKED
                  LIMIT 1
             )
         RETURNING id, storage_prefix, frame_count
            """
        )


async def mark_ready(pool: asyncpg.Pool, scan_id: Any, result_key: str) -> None:
    async with pool.acquire() as conn:
        await conn.execute(
            "UPDATE scans SET state='ready', result_key=$1, progress=100, error_message=NULL, updated_at=now() WHERE id=$2",
            result_key,
            scan_id,
        )


async def mark_failed(pool: asyncpg.Pool, scan_id: Any, error: str) -> None:
    async with pool.acquire() as conn:
        await conn.execute(
            "UPDATE scans SET state='failed', error_message=$1, updated_at=now() WHERE id=$2",
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
    """Run COLMAP SfM + Brush training, return the Garage key of result.ply.

    ``report(pct)`` is an optional best-effort progress callback (0–100) called
    at phase boundaries; the server forwards it to the SPA via the scans NOTIFY
    trigger. Never let a progress hiccup fail the job."""
    scan_id = scan["id"]
    prefix = scan["storage_prefix"]
    # This is the *client*-uploaded frame count — it's 0 for a video-only
    # gsplat scan, where the worker extracts the frames from the video itself.
    # The real floor is enforced on n_frames after _prepare_frames.
    frame_count = scan["frame_count"]

    def progress(pct: int) -> None:
        if report:
            try:
                report(pct)
            except Exception:  # noqa: BLE001
                pass

    progress(8)
    with tempfile.TemporaryDirectory(prefix="brush-") as tmp_str:
        tmp = Path(tmp_str)
        dataset = tmp / "dataset"
        images = dataset / "images"
        images.mkdir(parents=True)

        # 1. Get frames into images/ — preferring the scan's original video
        #    (full-res, ffmpeg-sampled) over the client's downscaled WebP set.
        n_frames = _prepare_frames(tmp, prefix, frame_count, images, scan_id)
        if n_frames < MIN_FRAMES:
            raise RuntimeError(f"only {n_frames} usable frames; need >= {MIN_FRAMES}")

        # 2. Optional foreground masking (huge quality win on turntables).
        #    Kept OUTSIDE the dataset dir so Brush doesn't try to read the
        #    COLMAP-convention mask files as its own.
        progress(20)
        mask_dir = None
        if ENABLE_MASKING:
            mask_dir = _make_masks(images, tmp / "colmap_masks", scan_id)

        # 3. COLMAP Structure-from-Motion -> sparse/0 (best component).
        progress(32)
        sparse = dataset / "sparse"
        _colmap_sfm(images, sparse, mask_dir, scan_id, n_frames)

        # 4. Brush training on Metal -> result.ply.
        progress(46)
        out = tmp / "out"
        out.mkdir()
        # NB: no --with-viewer. It's a presence flag (no value); passing a
        # source path already makes Brush run headless. Passing
        # "--with-viewer false" would treat `false` as a stray positional.
        _run(
            BRUSH_BIN,
            str(dataset),
            "--total-train-iters", str(TRAINING_ITERATIONS),
            "--export-every", str(TRAINING_ITERATIONS),
            "--export-path", str(out),
            "--export-name", "result.ply",
        )
        plys = sorted(out.rglob("*.ply"), key=lambda p: p.stat().st_mtime)
        if not plys:
            raise RuntimeError("Brush produced no .ply")
        ply_path = plys[-1]
        size = ply_path.stat().st_size
        log.info("training finished", scan_id=str(scan_id), ply=str(ply_path), bytes=size)

        # 5. Upload result to Garage under the scan's prefix.
        progress(88)
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
        progress(96)
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
    """Sample ~VIDEO_TARGET_FRAMES evenly-spaced, full-resolution PNG frames
    from the video with ffmpeg."""
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=nokey=1:noprint_wrappers=1", str(video)],
        check=False, capture_output=True, text=True,
    )
    try:
        duration = float(probe.stdout.strip())
    except ValueError:
        duration = 0.0
    fps = f"fps={max(0.1, VIDEO_TARGET_FRAMES / duration):.5f}" if duration > 0 else "fps=8"
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


def _colmap_sfm(
    images: Path, sparse: Path, mask_dir: Path | None, scan_id: Any, frame_count: int
) -> None:
    """Feature extraction + matching + mapping, then keep the best component.

    Tuned for the hard case (glossy, low-texture figures on a single-ring
    turntable): we crank SIFT to find more — and weaker — keypoints, relax the
    mapper's registration thresholds, and keep COLMAP's largest sub-model.
    """
    sparse.mkdir(parents=True, exist_ok=True)
    db = sparse.parent / "colmap.db"

    # COLMAP 4.x renamed the toggles to FeatureExtraction.* / FeatureMatching.*.
    # CPU extraction (use_gpu 0) is the safe path; we just ask SIFT for many
    # more, weaker features so low-texture surfaces still yield matches.
    extract = [
        COLMAP_BIN, "feature_extractor",
        "--database_path", str(db),
        "--image_path", str(images),
        "--ImageReader.single_camera", "1",
        "--ImageReader.camera_model", "OPENCV",
        "--FeatureExtraction.use_gpu", "0",
        "--SiftExtraction.max_num_features", "16384",
        "--SiftExtraction.peak_threshold", "0.004",
        "--SiftExtraction.edge_threshold", "16",
    ]
    if mask_dir is not None:
        extract += ["--ImageReader.mask_path", str(mask_dir)]
    _run(*extract)

    # GPU matcher (OpenGL/Metal SiftGPU — the CPU matcher segfaults on this
    # Homebrew build, and needs the window-server connection the LaunchAgent
    # provides). Exhaustive matching is O(n²): fine for a ~48-frame client
    # capture, but it crawls on the ~150 *ordered* frames from a video, so we
    # use sequential matching (consecutive frames + a window) there.
    if frame_count >= 60:
        _run(
            COLMAP_BIN, "sequential_matcher",
            "--database_path", str(db),
            "--FeatureMatching.use_gpu", "1",
            "--SequentialMatching.overlap", "20",
        )
    else:
        _run(
            COLMAP_BIN, "exhaustive_matcher",
            "--database_path", str(db),
            "--FeatureMatching.use_gpu", "1",
        )
    # Lenient registration — turntable SfM is marginal; admit more views.
    _run(
        COLMAP_BIN, "mapper",
        "--database_path", str(db),
        "--image_path", str(images),
        "--output_path", str(sparse),
        "--Mapper.init_min_num_inliers", "50",
        "--Mapper.abs_pose_min_num_inliers", "20",
    )
    _select_largest_model(sparse, scan_id, frame_count)


def _count_registered(model_dir: Path) -> int:
    """Registered-image count of a COLMAP model (the images.bin header's first
    u64 is the image count; fall back to parsing images.txt)."""
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
    (sparse/0, sparse/1, ...). Keep ONLY the one with the most registered
    images, collapsed to sparse/0, so Brush trains on the best model instead of
    an arbitrary tiny fragment."""
    comps = [
        (d, _count_registered(d))
        for d in sparse.iterdir()
        if d.is_dir() and (d / "images.bin").exists()
    ]
    if not comps:
        raise RuntimeError(
            "COLMAP produced no sparse model — Structure-from-Motion failed to "
            "register the frames. Glossy / low-texture figures on a single-ring "
            "turntable are very hard for SfM; see the README capture guide."
        )
    comps.sort(key=lambda c: c[1], reverse=True)
    best, best_n = comps[0]
    log.info(
        "colmap components",
        scan_id=str(scan_id),
        components={d.name: n for d, n in comps},
        best=best.name,
        registered=best_n,
        total=frame_count,
    )
    if best_n < 8:
        raise RuntimeError(
            f"SfM only registered {best_n}/{frame_count} frames — too few for a "
            "usable splat. The capture (glossy surface, single ring, masking) "
            "gave COLMAP too few consistent features; see the README capture "
            "guide (textured surface, diffuse light, multiple elevations)."
        )
    # Collapse to a single sparse/0 = the best component.
    keep = sparse / "__keep__"
    shutil.move(str(best), str(keep))
    for d in list(sparse.iterdir()):
        if d.is_dir() and d != keep:
            shutil.rmtree(d, ignore_errors=True)
    shutil.move(str(keep), str(sparse / "0"))


def _make_masks(images: Path, mask_dir: Path, scan_id: Any) -> Path | None:
    """Foreground segmentation for turntable captures. Two consumers, two
    conventions:

      * Brush reads per-pixel **alpha** straight from the images, so we bake
        the cutout into each ``images/frame_NNN.png`` (RGBA, background
        transparent) — no separate masks folder needed.
      * COLMAP wants a binary mask file named ``<image>.png`` (255 = keep,
        0 = ignore) under ``--ImageReader.mask_path``.

    Best-effort: if rembg isn't installed we log and skip rather than fail."""
    try:
        from rembg import new_session, remove  # type: ignore
    except Exception:  # noqa: BLE001
        log.warning("masking requested but rembg not installed; skipping", scan_id=str(scan_id))
        return None
    mask_dir.mkdir(parents=True, exist_ok=True)
    session = new_session()
    for img in sorted(images.glob("*.png")):
        with Image.open(img) as im:
            cut = remove(im.convert("RGBA"), session=session)
        # Brush: bake the alpha into the training image.
        cut.save(img)
        # COLMAP: binary mask, 0 = ignore / 255 = use, named "<image>.png".
        alpha = cut.split()[-1].point(lambda a: 255 if a > 10 else 0)
        alpha.save(mask_dir / f"{img.name}.png")
    log.info("masks generated", scan_id=str(scan_id), dir=str(mask_dir))
    return mask_dir


def _run(*cmd: str) -> None:
    """Subprocess wrapper that logs the command + raises on failure."""
    log.info("running", cmd=" ".join(cmd))
    proc = subprocess.run(cmd, check=False, capture_output=True, text=True)
    if proc.returncode != 0:
        msg = (
            f"{' '.join(cmd)} exited {proc.returncode}\n"
            f"--- stdout ---\n{proc.stdout[-2000:]}\n"
            f"--- stderr ---\n{proc.stderr[-2000:]}"
        )
        raise RuntimeError(msg)


# -----------------------------------------------------------------------------

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass

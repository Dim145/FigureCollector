"""
FigureCollector — Gaussian Splatting worker.

Polls the `scans` table for `state='pending' AND kind='gsplat'`, claims one
job at a time with `FOR UPDATE SKIP LOCKED`, runs the full SfM + training
pipeline locally on GPU, then uploads the result back to Garage and marks
the row as ready (or failed).

Environment:
    DATABASE_URL          required, postgres://user:pass@host:5432/db
    S3_ENDPOINT           required, e.g. http://garage:3902
    S3_BUCKET             required
    S3_ACCESS_KEY         required
    S3_SECRET_KEY         required
    S3_REGION             optional, defaults to "garage"
    POLL_INTERVAL         optional, seconds between polls (default 10)
    TRAINING_ITERATIONS   optional, splatfacto max-num-iterations (default 15000)
"""

from __future__ import annotations

import asyncio
import os
import subprocess
import tempfile
import traceback
from pathlib import Path
from typing import Any

import asyncpg
import boto3
import structlog
from botocore.config import Config as BotoConfig

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
TRAINING_ITERATIONS = int(os.environ.get("TRAINING_ITERATIONS", "15000"))

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


async def main() -> None:
    pool = await asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=4)
    log.info(
        "worker started",
        poll_interval=POLL_INTERVAL,
        bucket=S3_BUCKET,
        iterations=TRAINING_ITERATIONS,
    )
    try:
        while True:
            scan = await claim_next_pending(pool)
            if scan is None:
                await asyncio.sleep(POLL_INTERVAL)
                continue
            scan_id = scan["id"]
            log.info("scan claimed", scan_id=str(scan_id))
            try:
                result_key = await asyncio.to_thread(process_scan, scan)
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
        await pool.close()


# -----------------------------------------------------------------------------
# PG ops
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
            "UPDATE scans SET state='ready', result_key=$1, error_message=NULL, updated_at=now() WHERE id=$2",
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


# -----------------------------------------------------------------------------
# Pipeline (blocking; called via asyncio.to_thread)
# -----------------------------------------------------------------------------


def process_scan(scan: asyncpg.Record) -> str:
    """Run the full SfM + training pipeline and return the Garage key of the .ply."""
    scan_id = scan["id"]
    prefix = scan["storage_prefix"]
    frame_count = scan["frame_count"]
    if frame_count < 6:
        raise RuntimeError(f"too few frames ({frame_count}); need ≥6 for SfM")

    with tempfile.TemporaryDirectory(prefix="gsplat-") as tmp_str:
        tmp = Path(tmp_str)
        images = tmp / "images"
        images.mkdir()

        # 1. Pull frames from Garage.
        for i in range(frame_count):
            key = f"{prefix}frame_{i:03}.webp"
            local = images / f"frame_{i:03}.webp"
            s3.download_file(S3_BUCKET, key, str(local))
        log.info("frames downloaded", scan_id=str(scan_id), count=frame_count)

        # 2. Nerfstudio's image processor runs COLMAP internally and writes a
        #    nerfstudio-shaped dataset (transforms.json + images + sparse poses).
        processed = tmp / "processed"
        _run(
            "ns-process-data", "images",
            "--data", str(images),
            "--output-dir", str(processed),
            "--num-downscales", "0",
            "--num-frames-target", "999",
            "--no-skip-image-processing",
        )

        # 3. Train splatfacto. `--vis none` suppresses the viewer.
        trained = tmp / "trained"
        _run(
            "ns-train", "splatfacto",
            "--data", str(processed),
            "--output-dir", str(trained),
            "--max-num-iterations", str(TRAINING_ITERATIONS),
            "--vis", "none",
            "--logging.local-writer.enable", "False",
        )

        # 4. Find the config.yml the trainer produced.
        configs = sorted(trained.rglob("config.yml"))
        if not configs:
            raise RuntimeError("ns-train produced no config.yml")
        config_path = configs[-1]
        log.info("training finished", scan_id=str(scan_id), config=str(config_path))

        # 5. Export the Gaussian Splat to .ply.
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


def _run(*cmd: str) -> None:
    """Subprocess wrapper that logs the command + raises on failure."""
    log.info("running", cmd=" ".join(cmd))
    proc = subprocess.run(cmd, check=False, capture_output=True, text=True)
    if proc.returncode != 0:
        msg = f"{' '.join(cmd)} exited {proc.returncode}\n--- stdout ---\n{proc.stdout[-2000:]}\n--- stderr ---\n{proc.stderr[-2000:]}"
        raise RuntimeError(msg)


# -----------------------------------------------------------------------------

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass

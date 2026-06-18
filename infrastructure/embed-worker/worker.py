"""
FigureCollector — standalone image-embedding worker (visual / photo search).

A thin host around the shared embed loop (embed_index.run_embed_loop): it
registers as kind='embed' with the `embed` capability, heartbeats, and drains
figure_embedding_queue. CPU-only — no GPU needed; run it anywhere it can reach
the database and the API. The embedding itself (model, preprocessing, queue
writes) lives in embed_index.py — shared byte-for-byte with the gsplat worker,
which runs the SAME loop as a concurrent task. For a single-GPU deployment the
gsplat worker already does this job; this standalone exists for GPU-less hosts.

Environment:
    DATABASE_URL          required, postgres://user:pass@host:5432/db
    HEARTBEAT_INTERVAL    seconds between liveness pings (default 30)
    (plus the SERVER_URL / EMBED_* knobs read by embed_index — see its docstring)
"""

from __future__ import annotations

import asyncio
import os
import platform
import socket
import uuid
from dataclasses import dataclass
from typing import Any

import asyncpg
import onnxruntime as ort
import structlog

import embed_index

DATABASE_URL = os.environ["DATABASE_URL"]
HEARTBEAT_INTERVAL = int(os.environ.get("HEARTBEAT_INTERVAL", "30"))

# kind='embed' (admitted by migration 20260613000002) tags the role; the server
# gates (re)indexing on `capabilities @> ARRAY['embed']`.
WORKER_KIND = "embed"
WORKER_VERSION = "0.2.0"

log = structlog.get_logger()


@dataclass
class WorkerState:
    id: Any
    enabled: bool


def _hwinfo() -> dict[str, Any]:
    return {
        "hostname": socket.gethostname(),
        "os": f"{platform.system()} {platform.release()}",
        "arch": platform.machine(),
        "runtime_version": f"python {platform.python_version()} / onnxruntime {ort.__version__}",
    }


async def register_worker(pool: asyncpg.Pool) -> WorkerState:
    """UPSERT on (hostname, kind), (re)asserting the embed capability."""
    info = _hwinfo()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            INSERT INTO workers (
                id, hostname, kind, os, arch, gpu, gpu_memory_mb,
                runtime_version, worker_version, capabilities,
                heartbeat_interval_secs, last_seen
            ) VALUES ($1,$2,$3,$4,$5,NULL,NULL,$6,$7,$8,$9,NOW())
            ON CONFLICT (hostname, kind) DO UPDATE SET
                os                      = EXCLUDED.os,
                arch                    = EXCLUDED.arch,
                runtime_version         = EXCLUDED.runtime_version,
                worker_version          = EXCLUDED.worker_version,
                capabilities            = EXCLUDED.capabilities,
                heartbeat_interval_secs = EXCLUDED.heartbeat_interval_secs,
                last_seen               = NOW()
            RETURNING id, enabled
            """,
            uuid.uuid4(),
            info["hostname"],
            WORKER_KIND,
            info["os"],
            info["arch"],
            info["runtime_version"],
            WORKER_VERSION,
            [embed_index.EMBED_CAPABILITY],
            max(1, HEARTBEAT_INTERVAL),
        )
    return WorkerState(id=row["id"], enabled=row["enabled"])


async def heartbeat_loop(pool: asyncpg.Pool, state: WorkerState) -> None:
    while True:
        await asyncio.sleep(max(1, HEARTBEAT_INTERVAL))
        try:
            async with pool.acquire() as conn:
                row = await conn.fetchrow(
                    "UPDATE workers SET last_seen = NOW() WHERE id = $1 RETURNING enabled",
                    state.id,
                )
                if row is not None:
                    state.enabled = row["enabled"]
        except Exception as e:  # noqa: BLE001
            log.warning("heartbeat failed", error=str(e))


async def main() -> None:
    pool = await asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=4)
    state = await register_worker(pool)
    log.info(
        "embed worker started",
        worker_id=str(state.id),
        enabled=state.enabled,
        kind=WORKER_KIND,
    )
    asyncio.create_task(heartbeat_loop(pool, state))
    # Drain image + text queues concurrently (disjoint rows). Each loop loads its
    # model best-effort, so a worker baking only one model just idles the other.
    await asyncio.gather(
        embed_index.run_embed_loop(pool, state),
        embed_index.run_text_embed_loop(pool, state),
        embed_index.run_clip_embed_loop(pool, state),
        embed_index.run_tagger_loop(pool, state),
    )


if __name__ == "__main__":
    asyncio.run(main())

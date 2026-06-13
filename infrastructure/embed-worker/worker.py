"""
FigureCollector — image-embedding worker (visual / photo search).

Drains `figure_embedding_queue`: for each catalog image it claims, it fetches
the bytes, runs DINOv2-small to a 384-d descriptor, and writes the vector to
`figure_embeddings`. The user's QUERY photo is embedded in the browser with the
SAME model + preprocessing (client/src/lib/embed.js); this worker MUST stay in
lockstep so query and index share one vector space:

    * model:        Xenova/dinov2-small, the q8 ONNX (`model_quantized.onnx`)
    * preprocessing: convert RGB → resize shortest-edge to 256 (bicubic) →
                     centre-crop 224² → rescale 1/255 → normalise with the
                     ImageNet mean/std (from preprocessor_config.json)
    * descriptor:   the CLS token (row 0 of `last_hidden_state`), L2-normalised

Like the gsplat worker, all coordination is direct PostgreSQL (asyncpg) — there
is no worker→server HTTP control plane. Catalog images are fetched over HTTP:
`photo` rows via the server's public `/api/figure-photos/{uuid}` proxy (storage
-agnostic), `official` rows from their source URL.

Environment:
    DATABASE_URL          required, postgres://user:pass@host:5432/db
    SERVER_URL            base URL of the API for photo fetches
                          (default http://server:3000)
    MODEL_PATH            path to model_quantized.onnx (default /models/dinov2-small/model_quantized.onnx)
    POLL_INTERVAL         seconds between polls when the queue is empty (default 5)
    HEARTBEAT_INTERVAL    seconds between liveness pings (default 30)
    MAX_ATTEMPTS          retries before a queue row is marked failed (default 3)
    HTTP_TIMEOUT          per-image fetch timeout, seconds (default 30)
    MAX_IMAGE_BYTES       reject a fetched image larger than this (default 25 MiB)
"""

from __future__ import annotations

import asyncio
import io
import os
import platform
import socket
import traceback
import urllib.request
import uuid
from dataclasses import dataclass
from typing import Any

import asyncpg
import numpy as np
import onnxruntime as ort
import structlog
from PIL import Image

# -----------------------------------------------------------------------------
# Config
# -----------------------------------------------------------------------------

DATABASE_URL = os.environ["DATABASE_URL"]
SERVER_URL = os.environ.get("SERVER_URL", "http://server:3000").rstrip("/")
MODEL_PATH = os.environ.get("MODEL_PATH", "/models/dinov2-small/model_quantized.onnx")
POLL_INTERVAL = int(os.environ.get("POLL_INTERVAL", "5"))
HEARTBEAT_INTERVAL = int(os.environ.get("HEARTBEAT_INTERVAL", "30"))
MAX_ATTEMPTS = int(os.environ.get("MAX_ATTEMPTS", "3"))
HTTP_TIMEOUT = int(os.environ.get("HTTP_TIMEOUT", "30"))
MAX_IMAGE_BYTES = int(os.environ.get("MAX_IMAGE_BYTES", str(25 * 1024 * 1024)))

# MUST equal `domain::visual_search::MODEL_VERSION` (server) and `MODEL_VERSION`
# (client/src/lib/embed.js). Bumping the model means bumping this everywhere.
MODEL_VERSION = "dinov2-small/1"
EMBED_DIM = 384

# Worker identity. `kind='embed'` (admitted by migration 20260613000002) tags
# the role; the server gates (re)indexing on `capabilities @> ARRAY['embed']`.
WORKER_KIND = "embed"
WORKER_VERSION = "0.1.0"
CAPABILITIES = ["embed"]

# Preprocessing — verbatim from Xenova/dinov2-small/preprocessor_config.json.
SHORTEST_EDGE = 256
CROP = 224
IMAGE_MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)
IMAGE_STD = np.array([0.229, 0.224, 0.225], dtype=np.float32)

log = structlog.get_logger()


# -----------------------------------------------------------------------------
# Model
# -----------------------------------------------------------------------------


@dataclass
class Embedder:
    session: ort.InferenceSession
    input_name: str
    output_name: str

    @classmethod
    def load(cls) -> "Embedder":
        providers = [
            p
            for p in ("CUDAExecutionProvider", "CPUExecutionProvider")
            if p in ort.get_available_providers()
        ] or ["CPUExecutionProvider"]
        session = ort.InferenceSession(MODEL_PATH, providers=providers)
        input_name = session.get_inputs()[0].name
        # Prefer `last_hidden_state` (token sequence — we take its CLS row); fall
        # back to whichever output carries the 384-d feature dim.
        outs = session.get_outputs()
        output_name = next(
            (o.name for o in outs if "last_hidden_state" in o.name.lower()),
            None,
        )
        if output_name is None:
            output_name = next(
                (o.name for o in outs if o.shape and o.shape[-1] == EMBED_DIM),
                outs[0].name,
            )
        log.info(
            "model loaded",
            providers=session.get_providers(),
            input=input_name,
            output=output_name,
        )
        return cls(session=session, input_name=input_name, output_name=output_name)

    def embed(self, image_bytes: bytes) -> list[float]:
        with Image.open(io.BytesIO(image_bytes)) as im:
            pixels = _preprocess(im)
        out = self.session.run([self.output_name], {self.input_name: pixels})[0]
        arr = np.asarray(out, dtype=np.float32)
        # [1, tokens, 384] → CLS token (row 0); [1, 384] → use as-is.
        if arr.ndim == 3:
            vec = arr[0, 0, :]
        else:
            vec = arr.reshape(-1)[:EMBED_DIM]
        if vec.shape[0] != EMBED_DIM:
            raise ValueError(f"unexpected embedding length {vec.shape[0]}")
        norm = float(np.linalg.norm(vec))
        if norm > 0:
            vec = vec / norm
        return vec.astype(np.float32).tolist()


def _preprocess(im: Image.Image) -> np.ndarray:
    """Resize shortest-edge→256 (bicubic) · centre-crop 224² · /255 · normalise.
    Mirrors the transformers.js BitImageProcessor the browser uses."""
    im = im.convert("RGB")
    w, h = im.size
    scale = SHORTEST_EDGE / min(w, h)
    im = im.resize((round(w * scale), round(h * scale)), Image.Resampling.BICUBIC)
    w, h = im.size
    left = (w - CROP) // 2
    top = (h - CROP) // 2
    im = im.crop((left, top, left + CROP, top + CROP))
    arr = np.asarray(im, dtype=np.float32) / 255.0  # H, W, C
    arr = (arr - IMAGE_MEAN) / IMAGE_STD
    arr = np.transpose(arr, (2, 0, 1))[np.newaxis]  # 1, C, H, W
    return np.ascontiguousarray(arr, dtype=np.float32)


# -----------------------------------------------------------------------------
# Image fetch
# -----------------------------------------------------------------------------


def fetch_image(source: str, image_ref: str) -> bytes:
    """Catalog photos via the server's public proxy (storage-agnostic);
    `official` images from their source URL."""
    if source == "photo":
        url = f"{SERVER_URL}/api/figure-photos/{image_ref}"
    else:
        url = image_ref
    req = urllib.request.Request(url, headers={"User-Agent": "FigureCollector-embed-worker"})
    with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT) as resp:  # noqa: S310
        data = resp.read(MAX_IMAGE_BYTES + 1)
    if len(data) > MAX_IMAGE_BYTES:
        raise ValueError("image exceeds MAX_IMAGE_BYTES")
    if not data:
        raise ValueError("empty image")
    return data


# -----------------------------------------------------------------------------
# Worker registration + liveness (mirrors the gsplat worker)
# -----------------------------------------------------------------------------


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
    """UPSERT on (hostname, kind), and (re)assert the embed capability."""
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
            CAPABILITIES,
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


# -----------------------------------------------------------------------------
# Queue lifecycle
# -----------------------------------------------------------------------------


async def claim_next(pool: asyncpg.Pool) -> asyncpg.Record | None:
    async with pool.acquire() as conn:
        return await conn.fetchrow(
            """
            UPDATE figure_embedding_queue
               SET state = 'processing', claimed_at = now(), attempts = attempts + 1
             WHERE id = (
                 SELECT id FROM figure_embedding_queue
                  WHERE state = 'pending' AND model_version = $1
                  ORDER BY enqueued_at ASC
                  FOR UPDATE SKIP LOCKED
                  LIMIT 1
             )
         RETURNING id, figure_id, source, image_ref, model_version, attempts
            """,
            MODEL_VERSION,
        )


async def store_embedding(
    pool: asyncpg.Pool, item: asyncpg.Record, embedding: list[float]
) -> None:
    """Write the vector and mark the queue row done, atomically. The embedding
    is passed as a pgvector text literal (`[a,b,…]`) cast server-side, so we
    don't need the `pgvector` python package."""
    literal = "[" + ",".join(f"{x:.7f}" for x in embedding) + "]"
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute(
                """
                INSERT INTO figure_embeddings
                    (figure_id, source, image_ref, model_version, embedding)
                VALUES ($1, $2, $3, $4, $5::vector)
                ON CONFLICT (image_ref, model_version) DO UPDATE SET
                    figure_id  = EXCLUDED.figure_id,
                    source     = EXCLUDED.source,
                    embedding  = EXCLUDED.embedding,
                    created_at = now()
                """,
                item["figure_id"],
                item["source"],
                item["image_ref"],
                item["model_version"],
                literal,
            )
            await conn.execute(
                "UPDATE figure_embedding_queue SET state = 'done', error_message = NULL WHERE id = $1",
                item["id"],
            )


async def mark_failure(pool: asyncpg.Pool, item: asyncpg.Record, error: str) -> None:
    """Retry transient failures up to MAX_ATTEMPTS, then give up (failed)."""
    state = "failed" if item["attempts"] >= MAX_ATTEMPTS else "pending"
    async with pool.acquire() as conn:
        await conn.execute(
            "UPDATE figure_embedding_queue SET state = $1, error_message = $2 WHERE id = $3",
            state,
            error[:1000],
            item["id"],
        )
    log.warning(
        "embedding failed",
        queue_id=str(item["id"]),
        attempts=item["attempts"],
        next_state=state,
        error=error.splitlines()[0] if error else "",
    )


# -----------------------------------------------------------------------------
# Main loop
# -----------------------------------------------------------------------------


async def main() -> None:
    embedder = Embedder.load()
    pool = await asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=4)
    state = await register_worker(pool)
    log.info(
        "embed worker started",
        worker_id=str(state.id),
        enabled=state.enabled,
        model_version=MODEL_VERSION,
        server_url=SERVER_URL,
        poll_interval=POLL_INTERVAL,
    )
    asyncio.create_task(heartbeat_loop(pool, state))

    while True:
        if not state.enabled:
            await asyncio.sleep(POLL_INTERVAL)
            continue
        item = await claim_next(pool)
        if item is None:
            await asyncio.sleep(POLL_INTERVAL)
            continue
        try:
            # Fetch + embed are blocking (network + ONNX) → off the event loop.
            data = await asyncio.to_thread(fetch_image, item["source"], item["image_ref"])
            embedding = await asyncio.to_thread(embedder.embed, data)
            await store_embedding(pool, item, embedding)
            log.info(
                "embedded",
                figure_id=str(item["figure_id"]),
                source=item["source"],
                image_ref=item["image_ref"][:64],
            )
        except Exception as e:  # noqa: BLE001
            trace = traceback.format_exc()[-2000:]
            await mark_failure(pool, item, f"{type(e).__name__}: {e}\n{trace}")


if __name__ == "__main__":
    asyncio.run(main())

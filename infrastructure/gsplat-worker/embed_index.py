"""
FigureCollector — shared image-embedding logic for visual (photo) search.

⚠ DUPLICATED — an identical copy lives in BOTH:
    infrastructure/gsplat-worker/embed_index.py   (folded into the gsplat worker)
    infrastructure/embed-worker/embed_index.py    (the standalone CPU worker)
Keep the two byte-identical. The model + preprocessing contract is mirrored a
THIRD time in client/src/lib/embed.js (the in-browser query side) — bump
MODEL_VERSION on ALL of them together and re-index when the model changes.

Drains `figure_embedding_queue`: fetch each catalog image, embed it with
DINOv2-small (384-d, the CLS token of last_hidden_state, L2-normalised) and
write the vector to `figure_embeddings`. This is deliberately **CPU-only** — it
runs beside the gsplat trainer without ever touching its 6 GB of VRAM, and the
standalone variant needs no GPU at all. Coordination is direct PostgreSQL
(asyncpg), matching the gsplat worker; catalog images are fetched over HTTP
(`photo` rows via the server's public proxy, `official` rows from their URL).
"""

from __future__ import annotations

import asyncio
import io
import os
import traceback
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any

import asyncpg
import numpy as np
import onnxruntime as ort
import structlog
from PIL import Image

# --- Config (env, all embed-specific so it can't clash with a host worker) ----
SERVER_URL = os.environ.get("SERVER_URL", "http://server:3000").rstrip("/")
MODEL_PATH = os.environ.get(
    "EMBED_MODEL_PATH", "/models/dinov2-small/model_quantized.onnx"
)
POLL_INTERVAL = int(os.environ.get("EMBED_POLL_INTERVAL", "5"))
MAX_ATTEMPTS = int(os.environ.get("EMBED_MAX_ATTEMPTS", "3"))
HTTP_TIMEOUT = int(os.environ.get("EMBED_HTTP_TIMEOUT", "30"))
MAX_IMAGE_BYTES = int(os.environ.get("EMBED_MAX_IMAGE_BYTES", str(25 * 1024 * 1024)))

# MUST equal domain::visual_search::MODEL_VERSION (server) and MODEL_VERSION
# (client/src/lib/embed.js). The `embed` capability gates index (re)building.
MODEL_VERSION = "dinov2-small/1"
EMBED_DIM = 384
EMBED_CAPABILITY = "embed"

# Preprocessing — verbatim from Xenova/dinov2-small/preprocessor_config.json.
SHORTEST_EDGE = 256
CROP = 224
IMAGE_MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)
IMAGE_STD = np.array([0.229, 0.224, 0.225], dtype=np.float32)

log = structlog.get_logger()


# --- Model -------------------------------------------------------------------
@dataclass
class Embedder:
    session: ort.InferenceSession
    input_name: str
    output_name: str

    @classmethod
    def load(cls) -> "Embedder":
        # CPU-only on purpose: the embed pass must never contend with the gsplat
        # trainer for VRAM, and the standalone worker has no GPU anyway.
        session = ort.InferenceSession(MODEL_PATH, providers=["CPUExecutionProvider"])
        input_name = session.get_inputs()[0].name
        outs = session.get_outputs()
        output_name = next(
            (o.name for o in outs if "last_hidden_state" in o.name.lower()), None
        )
        if output_name is None:
            output_name = next(
                (o.name for o in outs if o.shape and o.shape[-1] == EMBED_DIM),
                outs[0].name,
            )
        log.info("embed model loaded", input=input_name, output=output_name)
        return cls(session=session, input_name=input_name, output_name=output_name)

    def embed(self, image_bytes: bytes) -> list[float]:
        with Image.open(io.BytesIO(image_bytes)) as im:
            pixels = _preprocess(im)
        out = self.session.run([self.output_name], {self.input_name: pixels})[0]
        arr = np.asarray(out, dtype=np.float32)
        # [1, tokens, 384] → CLS token (row 0); [1, 384] → use as-is.
        vec = arr[0, 0, :] if arr.ndim == 3 else arr.reshape(-1)[:EMBED_DIM]
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


# --- Image fetch -------------------------------------------------------------
def fetch_image(source: str, image_ref: str) -> bytes:
    """Catalog photos via the server's public proxy (storage-agnostic);
    `official` images from their source URL."""
    url = (
        f"{SERVER_URL}/api/figure-photos/{image_ref}"
        if source == "photo"
        else image_ref
    )
    req = urllib.request.Request(url, headers={"User-Agent": "FigureCollector-embed-worker"})
    with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT) as resp:  # noqa: S310
        data = resp.read(MAX_IMAGE_BYTES + 1)
    if len(data) > MAX_IMAGE_BYTES:
        raise ValueError("image exceeds EMBED_MAX_IMAGE_BYTES")
    if not data:
        raise ValueError("empty image")
    return data


# --- Queue lifecycle ---------------------------------------------------------
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
    """Write the vector + mark the queue row done, atomically. The embedding is
    passed as a pgvector text literal cast server-side, so no pgvector py dep."""
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


async def reconcile_missing(pool: asyncpg.Pool, item: asyncpg.Record) -> None:
    """The image is gone (a 404 from the photo proxy or the official URL) — drop
    its index + queue rows so the catalog stays aligned. This is NOT a failure:
    it's the worker self-healing references left behind by a deleted photo or a
    dead external URL. (A `photo` row won't be re-queued — its figure_photos row
    is gone; a dead `official` URL may re-queue on the next reindex and reconcile
    again, harmlessly.)"""
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute(
                "DELETE FROM figure_embeddings WHERE image_ref = $1 AND model_version = $2",
                item["image_ref"],
                item["model_version"],
            )
            await conn.execute(
                "DELETE FROM figure_embedding_queue WHERE id = $1",
                item["id"],
            )
    log.info(
        "reconciled missing image (404) — dropped from index",
        source=item["source"],
        image_ref=item["image_ref"][:64],
    )


# --- Loop --------------------------------------------------------------------
async def run_embed_loop(pool: asyncpg.Pool, state: Any) -> None:
    """Drain figure_embedding_queue until cancelled. `state` is any object with a
    live `.enabled` bool (the host worker's heartbeat refreshes it). Safe to run
    as a concurrent task beside another loop — fetch + ONNX run off-thread.

    Loading the model is best-effort: if it can't be loaded (e.g. not baked into
    this image) the loop logs and exits WITHOUT taking the host worker down."""
    try:
        embedder = await asyncio.to_thread(Embedder.load)
    except Exception as e:  # noqa: BLE001
        log.error("embed model load failed — embed loop disabled", error=str(e))
        return
    log.info("embed loop started", model_version=MODEL_VERSION, server_url=SERVER_URL)
    while True:
        if not getattr(state, "enabled", True):
            await asyncio.sleep(POLL_INTERVAL)
            continue
        item = await claim_next(pool)
        if item is None:
            await asyncio.sleep(POLL_INTERVAL)
            continue
        try:
            data = await asyncio.to_thread(fetch_image, item["source"], item["image_ref"])
            embedding = await asyncio.to_thread(embedder.embed, data)
            await store_embedding(pool, item, embedding)
            log.info(
                "embedded",
                figure_id=str(item["figure_id"]),
                source=item["source"],
                image_ref=item["image_ref"][:64],
            )
        except urllib.error.HTTPError as e:
            # 404 = the image no longer exists → self-heal (drop the entry), not
            # a failure. Any other HTTP status is a real error → retry/fail.
            if e.code == 404:
                await reconcile_missing(pool, item)
            else:
                await mark_failure(pool, item, f"HTTP {e.code}: {e}")
        except Exception as e:  # noqa: BLE001
            trace = traceback.format_exc()[-2000:]
            await mark_failure(pool, item, f"{type(e).__name__}: {e}\n{trace}")

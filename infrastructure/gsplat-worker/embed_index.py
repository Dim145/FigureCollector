"""
FigureCollector — shared embedding logic for visual (photo) + semantic (text)
search.

⚠ DUPLICATED — an identical copy lives in BOTH:
    infrastructure/gsplat-worker/embed_index.py   (folded into the gsplat worker)
    infrastructure/embed-worker/embed_index.py    (the standalone CPU worker)
Keep the two byte-identical. Each model + its preprocessing contract is mirrored
a THIRD time in client/src/lib/embed.js (the in-browser query side) — bump the
matching version (MODEL_VERSION / TEXT_MODEL_VERSION) on ALL of them together
and re-index when a model changes.

Drains `figure_embedding_queue` with two concurrent loops over disjoint rows:
  • run_embed_loop — fetch each catalog image, embed it with DINOv2-small
    (384-d, the CLS token of last_hidden_state, L2-normalised).
  • run_text_embed_loop — compose each figure's text (structured fields + a
    cleaned description) and embed it with multilingual-e5-small (384-d, the
    attention-masked mean of last_hidden_state, L2-normalised).
Both write to `figure_embeddings` and are deliberately **CPU-only** — they run
beside the gsplat trainer without ever touching its 6 GB of VRAM, and the
standalone variant needs no GPU at all. Coordination is direct PostgreSQL
(asyncpg); catalog images are fetched over HTTP (`photo` rows via the server's
public proxy, `official` rows from their URL), figure text straight from the DB.
Each loop loads its model best-effort: a worker that bakes only one model just
runs that one loop.
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
# fp16 graph, used when running on CUDA: the q8 (int8) graph's integer ops aren't
# implemented on the CUDA provider, so they fall back to CPU and shuffle tensors
# GPU↔CPU (the "Memcpy nodes" warning) — no real speedup. fp16 runs fully on the
# GPU. Same float32 in/out as q8 (a drop-in), and its vectors match q8 to ~0.008
# cosine distance, so the index stays aligned with the browser's q8 query. Only
# the gsplat worker bakes it; on CPU we always use q8 (faster there).
MODEL_PATH_FP16 = os.environ.get(
    "EMBED_MODEL_PATH_FP16", "/models/dinov2-small/model_fp16.onnx"
)
POLL_INTERVAL = int(os.environ.get("EMBED_POLL_INTERVAL", "5"))
MAX_ATTEMPTS = int(os.environ.get("EMBED_MAX_ATTEMPTS", "3"))
HTTP_TIMEOUT = int(os.environ.get("EMBED_HTTP_TIMEOUT", "30"))
MAX_IMAGE_BYTES = int(os.environ.get("EMBED_MAX_IMAGE_BYTES", str(25 * 1024 * 1024)))
# Inference device: "cpu" (default), "cuda" (use the GPU — needs onnxruntime-gpu,
# which the gsplat worker bundles; the standalone CPU image does not), or "auto"
# (GPU if available, else CPU). Default is CPU on purpose: folded into the gsplat
# worker on a 6 GB card, a CUDA embed session would hold a few hundred MB of VRAM
# continuously and tighten the trainer's tight budget — and DINOv2-small q8 is
# fast enough on CPU for typical catalogs. Set EMBED_DEVICE=cuda on a worker with
# spare VRAM (or a dedicated/bigger GPU) to index much faster.
EMBED_DEVICE = os.environ.get("EMBED_DEVICE", "cpu").strip().lower()

# MUST equal domain::visual_search::MODEL_VERSION (server) and MODEL_VERSION
# (client/src/lib/embed.js). The `embed` capability gates index (re)building.
MODEL_VERSION = "dinov2-small/1"
EMBED_DIM = 384
EMBED_CAPABILITY = "embed"

# --- Text model (semantic search) --------------------------------------------
# multilingual-e5-small: the SAME model the browser loads for "Sens" search.
# Catalog figures are indexed as `passage:` text (structured fields + a cleaned
# description), the browser embeds queries as `query:`; both mean-pool the last
# hidden state weighted by the attention mask and L2-normalise → 384-d. The
# Python path here is verified bit-for-bit identical to transformers.js. MUST
# equal domain::visual_search::TEXT_MODEL_VERSION (server) and TEXT_MODEL_VERSION
# (client/src/lib/embed.js) — bump all three together and reindex on change.
TEXT_MODEL_PATH = os.environ.get(
    "EMBED_TEXT_MODEL_PATH", "/models/e5-small/model_quantized.onnx"
)
TEXT_TOKENIZER_PATH = os.environ.get(
    "EMBED_TEXT_TOKENIZER_PATH", "/models/e5-small/tokenizer.json"
)
TEXT_MODEL_VERSION = "e5-small/1"
TEXT_PASSAGE_PREFIX = "passage: "
TEXT_MAX_TOKENS = int(os.environ.get("EMBED_TEXT_MAX_TOKENS", "512"))

# Preprocessing — verbatim from Xenova/dinov2-small/preprocessor_config.json.
SHORTEST_EDGE = 256
CROP = 224
IMAGE_MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)
IMAGE_STD = np.array([0.229, 0.224, 0.225], dtype=np.float32)

log = structlog.get_logger()


# --- Model -------------------------------------------------------------------
def _resolve_providers() -> list[str]:
    """onnxruntime execution providers per EMBED_DEVICE. CUDA is preferred only
    when explicitly asked (or 'auto') AND actually available, with CPU as a
    fallback; otherwise CPU. A missing CUDA provider under EMBED_DEVICE=cuda
    degrades to CPU with a warning rather than crashing the worker."""
    if EMBED_DEVICE in ("cuda", "auto"):
        available = ort.get_available_providers()
        if "CUDAExecutionProvider" in available:
            return ["CUDAExecutionProvider", "CPUExecutionProvider"]
        if EMBED_DEVICE == "cuda":
            log.warning(
                "EMBED_DEVICE=cuda but CUDAExecutionProvider is unavailable — using CPU",
                available=available,
            )
    return ["CPUExecutionProvider"]


@dataclass
class Embedder:
    session: ort.InferenceSession
    input_name: str
    output_name: str

    @classmethod
    def load(cls) -> "Embedder":
        providers = _resolve_providers()
        # On CUDA, prefer the fp16 graph (q8 isn't GPU-friendly); on CPU, q8 is
        # fastest. Fall back to q8 if the fp16 file isn't present (e.g. the
        # standalone CPU image doesn't bake it).
        on_cuda = providers[0] == "CUDAExecutionProvider"
        model_path = (
            MODEL_PATH_FP16 if on_cuda and os.path.exists(MODEL_PATH_FP16) else MODEL_PATH
        )
        session = ort.InferenceSession(model_path, providers=providers)
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
        log.info(
            "embed model loaded",
            device=EMBED_DEVICE,
            model=os.path.basename(model_path),
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


# --- Text model --------------------------------------------------------------
@dataclass
class TextEmbedder:
    session: ort.InferenceSession
    tokenizer: Any
    input_names: set
    output_name: str

    @classmethod
    def load(cls) -> "TextEmbedder":
        from tokenizers import Tokenizer  # local import: only needed for text

        providers = _resolve_providers()
        session = ort.InferenceSession(TEXT_MODEL_PATH, providers=providers)
        tokenizer = Tokenizer.from_file(TEXT_TOKENIZER_PATH)
        try:
            tokenizer.enable_truncation(max_length=TEXT_MAX_TOKENS)
        except Exception:  # noqa: BLE001
            pass
        names = {i.name for i in session.get_inputs()}
        outs = [o.name for o in session.get_outputs()]
        output_name = next((o for o in outs if "last_hidden" in o.lower()), outs[0])
        log.info(
            "text embed model loaded",
            device=EMBED_DEVICE,
            model=os.path.basename(TEXT_MODEL_PATH),
            providers=session.get_providers(),
            inputs=sorted(names),
            output=output_name,
        )
        return cls(
            session=session,
            tokenizer=tokenizer,
            input_names=names,
            output_name=output_name,
        )

    def embed(self, text: str) -> list[float]:
        enc = self.tokenizer.encode(TEXT_PASSAGE_PREFIX + (text or ""))
        ids = np.array([enc.ids], dtype=np.int64)
        mask = np.array([enc.attention_mask], dtype=np.int64)
        feeds: dict[str, np.ndarray] = {"input_ids": ids, "attention_mask": mask}
        if "token_type_ids" in self.input_names:
            feeds["token_type_ids"] = np.zeros_like(ids)
        out = self.session.run([self.output_name], feeds)[0]
        hidden = np.asarray(out, dtype=np.float32)[0]  # [seq, 384]
        m = mask[0][:, None].astype(np.float32)  # [seq, 1]
        denom = float(m.sum()) or 1.0
        vec = (hidden * m).sum(axis=0) / denom  # attention-masked mean pool
        if vec.shape[0] != EMBED_DIM:
            raise ValueError(f"unexpected text embedding length {vec.shape[0]}")
        norm = float(np.linalg.norm(vec))
        if norm > 0:
            vec = vec / norm
        return vec.astype(np.float32).tolist()


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


# --- Text fetch + composition ------------------------------------------------
def _clean_text(s: str | None) -> str:
    """Strip the scraped boilerplate that only dilutes the embedding (source
    URLs, 'not specified' placeholders) while keeping descriptive prose."""
    import re

    if not s:
        return ""
    lines = [l for l in s.split("\n") if not re.match(r"^\s*source\s*:", l, re.I)]
    s = " ".join(lines)
    s = re.sub(r"https?://\S+", " ", s)
    s = re.sub(r"\b(not specified|n/a|unknown)\b", " ", s, flags=re.I)
    return re.sub(r"\s+", " ", s).strip()


def compose_figure_text(rec: asyncpg.Record) -> str:
    """Build the passage text for a figure. MUST mirror the client/dev-seed
    composition (client/src/lib/embed.js + the catalogue's semantic seed): the
    same field order and cleaning, so the worker-built index lines up with the
    vectors the browser embeds queries against."""
    parts: list[str] = []
    if rec["name"]:
        parts.append(rec["name"])
    ctx = [x for x in (rec["character_name"], rec["series_name"]) if x]
    if ctx:
        parts.append(", ".join(ctx))
    made: list[str] = []
    if rec["manufacturer_name"]:
        made.append(rec["manufacturer_name"])
    if rec["sculptor_name"]:
        made.append("sculpté par " + rec["sculptor_name"])
    if made:
        parts.append(", ".join(made))
    specs: list[str] = []
    if rec["figure_type"]:
        specs.append(rec["figure_type"])
    if rec["scale"]:
        specs.append("échelle " + rec["scale"])
    if rec["materials"]:
        specs.append(", ".join(rec["materials"]))
    if rec["version_name"]:
        specs.append(rec["version_name"])
    if rec["edition"]:
        specs.append(rec["edition"])
    if rec["exclusivity"]:
        specs.append(rec["exclusivity"])
    if specs:
        parts.append(", ".join(specs))
    desc = _clean_text(rec["description"])
    if desc:
        parts.append(desc[:500])
    return ". ".join(parts)


async def fetch_figure_text(pool: asyncpg.Pool, figure_id: Any) -> str | None:
    """Load a figure + its joined names and compose its passage text. Returns
    None if the figure no longer exists (deleted) → the caller reconciles."""
    async with pool.acquire() as conn:
        rec = await conn.fetchrow(
            """
            SELECT f.name, f.figure_type, f.scale, f.materials, f.version_name,
                   f.edition, f.exclusivity, f.description,
                   m.name  AS manufacturer_name,
                   sc.name AS sculptor_name,
                   (SELECT s.name FROM figure_series fs JOIN series s ON s.id = fs.series_id
                     WHERE fs.figure_id = f.id ORDER BY fs.series_id LIMIT 1) AS series_name,
                   (SELECT ch.name FROM figure_characters fc JOIN characters ch ON ch.id = fc.character_id
                     WHERE fc.figure_id = f.id ORDER BY fc.character_id LIMIT 1) AS character_name
              FROM figures f
              LEFT JOIN manufacturers m  ON m.id  = f.manufacturer_id
              LEFT JOIN sculptors     sc ON sc.id = f.sculptor_id
             WHERE f.id = $1
            """,
            figure_id,
        )
    return None if rec is None else compose_figure_text(rec)


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


async def claim_next_text(pool: asyncpg.Pool) -> asyncpg.Record | None:
    """Same SKIP LOCKED claim as `claim_next`, but for the TEXT model rows
    (`model_version = e5-small/1`, `source = 'text'`). The two loops drain
    disjoint queue rows so they never contend for the same work."""
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
            TEXT_MODEL_VERSION,
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


async def run_text_embed_loop(pool: asyncpg.Pool, state: Any) -> None:
    """Drain the TEXT rows of figure_embedding_queue (model_version=e5-small/1):
    compose each figure's passage text, embed it with multilingual-e5-small,
    store the 384-d vector. The text twin of run_embed_loop — runs as a SECOND
    concurrent task beside it, draining a disjoint set of queue rows.

    Best-effort load (mirrors run_embed_loop): if the e5 model/tokenizer isn't
    baked into this image, it logs and exits WITHOUT taking the host worker
    down — an image-only worker simply skips text indexing."""
    try:
        embedder = await asyncio.to_thread(TextEmbedder.load)
    except Exception as e:  # noqa: BLE001
        log.warning("text embed model load failed — text embed loop disabled", error=str(e))
        return
    log.info("text embed loop started", model_version=TEXT_MODEL_VERSION, server_url=SERVER_URL)
    while True:
        if not getattr(state, "enabled", True):
            await asyncio.sleep(POLL_INTERVAL)
            continue
        item = await claim_next_text(pool)
        if item is None:
            await asyncio.sleep(POLL_INTERVAL)
            continue
        try:
            text = await fetch_figure_text(pool, item["figure_id"])
            if text is None:
                # The figure was deleted → drop its text index + queue rows
                # (self-heal, not a failure), same as a vanished image.
                await reconcile_missing(pool, item)
                continue
            embedding = await asyncio.to_thread(embedder.embed, text)
            await store_embedding(pool, item, embedding)
            log.info(
                "text embedded",
                figure_id=str(item["figure_id"]),
                image_ref=item["image_ref"][:64],
            )
        except Exception as e:  # noqa: BLE001
            trace = traceback.format_exc()[-2000:]
            await mark_failure(pool, item, f"{type(e).__name__}: {e}\n{trace}")

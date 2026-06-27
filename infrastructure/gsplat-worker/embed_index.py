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
Each loop loads its model lazily — on the first queued item, then freed again
after EMBED_MODEL_IDLE_GRACE seconds idle so it only occupies RAM while work is
flowing — and best-effort: a worker missing a given model releases that model's
jobs and disables just that one loop.
"""

from __future__ import annotations

import asyncio
import gc
import io
import os
import time
import traceback
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any, Callable

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
# Seconds a model stays resident after its last use before it's unloaded to free
# RAM (it reloads on demand when work next arrives). Default 5 min; 0 = unload as
# soon as the queue drains.
MODEL_IDLE_GRACE = int(os.environ.get("EMBED_MODEL_IDLE_GRACE", "300"))
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

# --- Multimodal model (search by look) ---------------------------------------
# multilingual-SigLIP2-base VISION tower: embeds catalog images into the shared
# image+text space the browser's text tower queries. 768-d, its own table
# `figure_clip_embeddings`. SigLIP preprocessing differs from DINOv2: a plain
# resize to 224² (no shortest-edge + crop), rescale /255, normalise with 0.5 mean
# & std. The image embedding is the vision tower's `pooler_output`, L2-normalised.
# MUST equal domain::visual_search::CLIP_MODEL_VERSION (server).
CLIP_MODEL_PATH = os.environ.get(
    "EMBED_CLIP_MODEL_PATH", "/models/siglip2/vision_model_quantized.onnx"
)
CLIP_MODEL_VERSION = "siglip2-base/1"
CLIP_EMBED_DIM = 768
CLIP_IMAGE_SIZE = 224

# --- Appearance tagging (WD-Tagger v3) ---------------------------------------
# Tags catalog images with Danbooru tags (character, hair colour, outfit, "elf"…)
# and writes them to figures.visual_tags; compose_figure_text appends them to
# the e5 passage so semantic "Sens" search finds figures by look. NOT an
# embedding model — worker-only, no in-browser counterpart (the query side is the
# existing e5). Preprocessing (SmilingWolf wd-v3): pad to square (white), resize
# 448 (BICUBIC), RGB→BGR, raw 0-255 (NHWC), no mean/std. MUST equal
# domain::visual_search::TAGGER_MODEL_VERSION.
TAGGER_MODEL_PATH = os.environ.get("EMBED_TAGGER_MODEL_PATH", "/models/wd-tagger-v3/model.onnx")
TAGGER_TAGS_PATH = os.environ.get("EMBED_TAGGER_TAGS_PATH", "/models/wd-tagger-v3/selected_tags.csv")
TAGGER_MODEL_VERSION = "wd-tagger-v3/1"
TAGGER_IMAGE_SIZE = 448
TAGGER_GENERAL_THRESHOLD = float(os.environ.get("EMBED_TAGGER_GENERAL_THRESHOLD", "0.35"))
TAGGER_CHARACTER_THRESHOLD = float(os.environ.get("EMBED_TAGGER_CHARACTER_THRESHOLD", "0.5"))
TAGGER_MAX_GENERAL = int(os.environ.get("EMBED_TAGGER_MAX_GENERAL", "25"))
# Tag up to this many of a figure's images (all uploaded photos + the official
# image, primary first) and MERGE the tags — most overlap, but extra angles add
# detail. Caps the per-figure cost; raise/lower via env.
TAGGER_MAX_IMAGES = int(os.environ.get("EMBED_TAGGER_MAX_IMAGES", "10"))

# Owned-photo tagging rides the SAME WD-Tagger model + shared queue, but with a
# distinct `source` so the two tagger loops drain disjoint rows. Owned photos
# are user-PRIVATE (unlike catalogue images, served by a public proxy), so the
# server exposes them to the worker via an internal route gated by a shared
# bearer token. Set EMBED_WORKER_TOKEN here to the server's WORKER_INTERNAL_TOKEN
# — when unset, the server route is disabled and owned-photo tagging just idles.
OWNED_TAGS_SOURCE = "owned_tags"
WORKER_INTERNAL_TOKEN = os.environ.get("EMBED_WORKER_TOKEN", "").strip()

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


class LazyModel:
    """Loads an embedder on first use and frees it after `grace` seconds of
    inactivity, so a model only occupies RAM while work is flowing (plus the
    grace window). One instance per loop — never shared — so no lock is needed:
    the owning loop is the only coroutine that touches it, between awaits.

    `acquire()` (re)loads off-thread on demand; `unload_if_idle()` is called from
    the loop's idle branch and drops the ONNX session once the queue goes quiet."""

    def __init__(self, label: str, loader: Callable[[], Any]) -> None:
        self.label = label
        self._loader = loader
        self._model: Any = None
        self._last_used = 0.0

    async def acquire(self) -> Any:
        """The loaded model — loaded off-thread on first use / after an unload."""
        if self._model is None:
            self._model = await asyncio.to_thread(self._loader)
        self._last_used = time.monotonic()
        return self._model

    def unload_if_idle(self, grace: float) -> None:
        """Drop the model if it's been idle ≥ grace seconds (frees its ONNX
        session). No-op when already unloaded or still within the grace window."""
        if self._model is not None and time.monotonic() - self._last_used >= grace:
            self._model = None
            gc.collect()
            log.info("model unloaded (idle)", model=self.label, grace_s=int(grace))


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


# --- Multimodal vision model (search by look) --------------------------------
@dataclass
class ClipVisionEmbedder:
    session: ort.InferenceSession
    input_name: str
    output_name: str

    @classmethod
    def load(cls) -> "ClipVisionEmbedder":
        providers = _resolve_providers()
        session = ort.InferenceSession(CLIP_MODEL_PATH, providers=providers)
        input_name = session.get_inputs()[0].name
        outs = [o.name for o in session.get_outputs()]
        output_name = next((o for o in outs if "pool" in o.lower()), outs[-1])
        log.info(
            "clip vision model loaded",
            device=EMBED_DEVICE,
            model=os.path.basename(CLIP_MODEL_PATH),
            providers=session.get_providers(),
            input=input_name,
            output=output_name,
        )
        return cls(session=session, input_name=input_name, output_name=output_name)

    def embed(self, image_bytes: bytes) -> list[float]:
        # SigLIP preprocessing: plain resize to 224² (no crop), /255, normalise 0.5.
        with Image.open(io.BytesIO(image_bytes)) as im:
            im = im.convert("RGB").resize((CLIP_IMAGE_SIZE, CLIP_IMAGE_SIZE), Image.BILINEAR)
            arr = (np.asarray(im, dtype=np.float32) / 255.0 - 0.5) / 0.5
        arr = np.transpose(arr, (2, 0, 1))[np.newaxis]  # 1, C, H, W
        out = self.session.run(
            [self.output_name],
            {self.input_name: np.ascontiguousarray(arr, dtype=np.float32)},
        )[0]
        vec = np.asarray(out, dtype=np.float32).reshape(-1)
        if vec.shape[0] != CLIP_EMBED_DIM:
            raise ValueError(f"unexpected clip embedding length {vec.shape[0]}")
        norm = float(np.linalg.norm(vec))
        if norm > 0:
            vec = vec / norm
        return vec.astype(np.float32).tolist()


# --- Appearance tagger (WD-Tagger v3) ----------------------------------------
@dataclass
class TaggerEmbedder:
    session: ort.InferenceSession
    input_name: str
    names: list
    cats: list

    @classmethod
    def load(cls) -> "TaggerEmbedder":
        import csv as _csv

        providers = _resolve_providers()
        session = ort.InferenceSession(TAGGER_MODEL_PATH, providers=providers)
        names, cats = [], []
        with open(TAGGER_TAGS_PATH, newline="", encoding="utf-8") as fh:
            for row in _csv.DictReader(fh):
                names.append(row["name"])
                cats.append(int(row["category"]))
        log.info(
            "tagger model loaded",
            device=EMBED_DEVICE,
            model=os.path.basename(TAGGER_MODEL_PATH),
            providers=session.get_providers(),
            tags=len(names),
        )
        return cls(session=session, input_name=session.get_inputs()[0].name, names=names, cats=cats)

    def tag(self, image_bytes: bytes) -> str:
        with Image.open(io.BytesIO(image_bytes)) as im:
            im = im.convert("RGBA")
            bg = Image.new("RGBA", im.size, (255, 255, 255, 255))
            bg.alpha_composite(im)
            im = bg.convert("RGB")
            side = max(im.size)
            sq = Image.new("RGB", (side, side), (255, 255, 255))
            sq.paste(im, ((side - im.width) // 2, (side - im.height) // 2))
            sq = sq.resize((TAGGER_IMAGE_SIZE, TAGGER_IMAGE_SIZE), Image.BICUBIC)
            arr = np.asarray(sq, dtype=np.float32)[:, :, ::-1]  # RGB→BGR, 0-255
        arr = np.ascontiguousarray(arr[np.newaxis])  # 1, 448, 448, 3 (NHWC)
        probs = self.session.run(None, {self.input_name: arr})[0][0]
        chars, gens = [], []
        for i in np.argsort(-probs):  # highest probability first
            cat, p = self.cats[i], float(probs[i])
            if cat == 4 and p > TAGGER_CHARACTER_THRESHOLD:
                chars.append(self.names[i])
            elif cat == 0 and p > TAGGER_GENERAL_THRESHOLD and len(gens) < TAGGER_MAX_GENERAL:
                gens.append(self.names[i])
        return ", ".join(t.replace("_", " ") for t in (chars + gens))


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


def fetch_owned_photo(photo_id: str) -> bytes:
    """Fetch a user's PRIVATE owned photo (for owned-photo tagging). Mirrors
    `fetch_image`, but hits the server's internal owned-photo route with the
    shared bearer token instead of the public catalogue proxy — owned photos are
    owner-gated, so the worker can't use the public `/api/photos/{id}` route."""
    if not WORKER_INTERNAL_TOKEN:
        raise RuntimeError("EMBED_WORKER_TOKEN unset — cannot fetch private owned photos")
    url = f"{SERVER_URL}/api/internal/owned-photos/{photo_id}"
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "FigureCollector-embed-worker",
            "Authorization": f"Bearer {WORKER_INTERNAL_TOKEN}",
        },
    )
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


async def fetch_figure_tags(pool: asyncpg.Pool, figure_id: Any) -> str | None:
    """The figure's appearance tags as a passage (its own e5 vector, kept apart
    from the descriptive text so the tags aren't diluted). None if absent."""
    async with pool.acquire() as conn:
        tags = await conn.fetchval("SELECT visual_tags FROM figures WHERE id = $1", figure_id)
    tags = (tags or "").strip() if tags is not None else None
    return tags or None


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


async def release_claim(pool: asyncpg.Pool, item: asyncpg.Record) -> None:
    """Return a claimed item to 'pending' WITHOUT counting a failure — used when
    this worker can't load the model for it (e.g. that model isn't baked into this
    image). Undoes claim's attempts++ so the job keeps its full retry budget and
    stays available for a worker that can handle it."""
    async with pool.acquire() as conn:
        await conn.execute(
            "UPDATE figure_embedding_queue "
            "SET state = 'pending', claimed_at = NULL, attempts = GREATEST(attempts - 1, 0) "
            "WHERE id = $1",
            item["id"],
        )


# --- Loop --------------------------------------------------------------------
async def run_embed_loop(pool: asyncpg.Pool, state: Any) -> None:
    """Drain figure_embedding_queue until cancelled. `state` is any object with a
    live `.enabled` bool (the host worker's heartbeat refreshes it). Safe to run
    as a concurrent task beside another loop — fetch + ONNX run off-thread.

    Loading the model is best-effort: if it can't be loaded (e.g. not baked into
    this image) the loop logs and exits WITHOUT taking the host worker down."""
    model = LazyModel("dinov2", Embedder.load)
    log.info("embed loop started", model_version=MODEL_VERSION, server_url=SERVER_URL)
    while True:
        if not getattr(state, "enabled", True):
            model.unload_if_idle(MODEL_IDLE_GRACE)
            await asyncio.sleep(POLL_INTERVAL)
            continue
        item = await claim_next(pool)
        if item is None:
            model.unload_if_idle(MODEL_IDLE_GRACE)
            await asyncio.sleep(POLL_INTERVAL)
            continue
        try:
            embedder = await model.acquire()
        except Exception as e:  # noqa: BLE001
            log.error("embed model load failed — releasing item, embed loop disabled", error=str(e))
            await release_claim(pool, item)
            return
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
    model = LazyModel("e5-text", TextEmbedder.load)
    log.info("text embed loop started", model_version=TEXT_MODEL_VERSION, server_url=SERVER_URL)
    while True:
        if not getattr(state, "enabled", True):
            model.unload_if_idle(MODEL_IDLE_GRACE)
            await asyncio.sleep(POLL_INTERVAL)
            continue
        item = await claim_next_text(pool)
        if item is None:
            model.unload_if_idle(MODEL_IDLE_GRACE)
            await asyncio.sleep(POLL_INTERVAL)
            continue
        try:
            embedder = await model.acquire()
        except Exception as e:  # noqa: BLE001
            log.warning("text embed model load failed — releasing item, text embed loop disabled", error=str(e))
            await release_claim(pool, item)
            return
        try:
            # Two kinds of e5 rows share this loop: 'text:<id>' (the figure's
            # descriptive passage) and 'tagvec:<id>' (its appearance tags as a
            # SEPARATE vector, so tags aren't diluted by the description). Search
            # dedups by figure and keeps whichever is the closer match.
            is_tags = item["image_ref"].startswith("tagvec:")
            text = (
                await fetch_figure_tags(pool, item["figure_id"])
                if is_tags
                else await fetch_figure_text(pool, item["figure_id"])
            )
            if text is None:
                # Figure deleted, or no tags to embed → drop index + queue rows.
                await reconcile_missing(pool, item)
                continue
            embedding = await asyncio.to_thread(embedder.embed, text)
            await store_embedding(pool, item, embedding)
            log.info(
                "text embedded",
                figure_id=str(item["figure_id"]),
                kind="tags" if is_tags else "text",
                image_ref=item["image_ref"][:64],
            )
        except Exception as e:  # noqa: BLE001
            trace = traceback.format_exc()[-2000:]
            await mark_failure(pool, item, f"{type(e).__name__}: {e}\n{trace}")


async def claim_next_clip(pool: asyncpg.Pool) -> asyncpg.Record | None:
    """Claim a pending SigLIP image row (model_version = siglip2-base/1) — the
    image twin of `claim_next_text`, draining its own disjoint queue rows."""
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
            CLIP_MODEL_VERSION,
        )


async def store_clip_embedding(
    pool: asyncpg.Pool, item: asyncpg.Record, embedding: list[float]
) -> None:
    """Write the 768-d SigLIP vector to figure_clip_embeddings + mark the queue
    row done, atomically (pgvector text literal cast server-side)."""
    literal = "[" + ",".join(f"{x:.7f}" for x in embedding) + "]"
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute(
                """
                INSERT INTO figure_clip_embeddings
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


async def reconcile_missing_clip(pool: asyncpg.Pool, item: asyncpg.Record) -> None:
    """The image is gone (404) → drop its clip index + queue rows. Self-heal,
    not a failure (mirrors reconcile_missing for the clip table)."""
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute(
                "DELETE FROM figure_clip_embeddings WHERE image_ref = $1 AND model_version = $2",
                item["image_ref"],
                item["model_version"],
            )
            await conn.execute("DELETE FROM figure_embedding_queue WHERE id = $1", item["id"])
    log.info(
        "reconciled missing clip image (404) — dropped from index",
        source=item["source"],
        image_ref=item["image_ref"][:64],
    )


async def run_clip_embed_loop(pool: asyncpg.Pool, state: Any) -> None:
    """Drain the SigLIP image rows of figure_embedding_queue: fetch each catalog
    image, embed it with the SigLIP vision tower (768-d), store in
    figure_clip_embeddings. The "search by look" twin of run_embed_loop — runs as
    a THIRD concurrent task. Best-effort load: skips if the SigLIP model isn't
    baked into this image, without taking the host worker down."""
    model = LazyModel("siglip-vision", ClipVisionEmbedder.load)
    log.info("clip embed loop started", model_version=CLIP_MODEL_VERSION, server_url=SERVER_URL)
    while True:
        if not getattr(state, "enabled", True):
            model.unload_if_idle(MODEL_IDLE_GRACE)
            await asyncio.sleep(POLL_INTERVAL)
            continue
        item = await claim_next_clip(pool)
        if item is None:
            model.unload_if_idle(MODEL_IDLE_GRACE)
            await asyncio.sleep(POLL_INTERVAL)
            continue
        try:
            embedder = await model.acquire()
        except Exception as e:  # noqa: BLE001
            log.warning("clip vision model load failed — releasing item, clip embed loop disabled", error=str(e))
            await release_claim(pool, item)
            return
        try:
            data = await asyncio.to_thread(fetch_image, item["source"], item["image_ref"])
            embedding = await asyncio.to_thread(embedder.embed, data)
            await store_clip_embedding(pool, item, embedding)
            log.info(
                "clip embedded",
                figure_id=str(item["figure_id"]),
                source=item["source"],
                image_ref=item["image_ref"][:64],
            )
        except urllib.error.HTTPError as e:
            if e.code == 404:
                await reconcile_missing_clip(pool, item)
            else:
                await mark_failure(pool, item, f"HTTP {e.code}: {e}")
        except Exception as e:  # noqa: BLE001
            trace = traceback.format_exc()[-2000:]
            await mark_failure(pool, item, f"{type(e).__name__}: {e}\n{trace}")


# --- Appearance tagging lifecycle --------------------------------------------
async def claim_next_tags(pool: asyncpg.Pool) -> asyncpg.Record | None:
    """Claim a pending CATALOGUE tagging job (model_version = wd-tagger-v3/1, one
    per figure: source='tags', image_ref='tags:<id>'). Scoped by source so it
    never claims OWNED-photo tag rows ('owned_tags'), which share the model
    version but are drained by `claim_next_owned_tags`."""
    async with pool.acquire() as conn:
        return await conn.fetchrow(
            """
            UPDATE figure_embedding_queue
               SET state = 'processing', claimed_at = now(), attempts = attempts + 1
             WHERE id = (
                 SELECT id FROM figure_embedding_queue
                  WHERE state = 'pending' AND model_version = $1 AND source = 'tags'
                  ORDER BY enqueued_at ASC
                  FOR UPDATE SKIP LOCKED
                  LIMIT 1
             )
         RETURNING id, figure_id, source, image_ref, model_version, attempts
            """,
            TAGGER_MODEL_VERSION,
        )


async def fetch_figure_all_images(pool: asyncpg.Pool, figure_id: Any) -> list:
    """Every image worth tagging for a figure — all its uploaded photos (primary
    first) PLUS its official image — capped at TAGGER_MAX_IMAGES. The tagger tags
    each and merges the results, so the figure picks up whatever any angle reveals
    (most tags overlap; extras add detail). Returns [(source, image_ref), …]."""
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT fp.id::text AS ref
              FROM figure_photos fp
             WHERE fp.figure_id = $1
             ORDER BY fp.is_primary DESC, fp.position ASC, fp.created_at ASC
            """,
            figure_id,
        )
        official = await conn.fetchval(
            "SELECT official_image_url FROM figures WHERE id = $1", figure_id
        )
    imgs = [("photo", r["ref"]) for r in rows]
    if official and official.strip():
        imgs.append(("official", official))
    return imgs[:TAGGER_MAX_IMAGES]


async def store_tags(pool: asyncpg.Pool, item: asyncpg.Record, tags: str) -> None:
    """Write the figure's appearance tags, mark the job done, and enqueue a
    SEPARATE e5 vector for the tags ('tagvec:<id>') so the semantic index can
    match them without dilution (the text loop embeds it next)."""
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute(
                "UPDATE figures SET visual_tags = $2 WHERE id = $1", item["figure_id"], tags
            )
            await conn.execute(
                "UPDATE figure_embedding_queue SET state = 'done', error_message = NULL WHERE id = $1",
                item["id"],
            )
            await conn.execute(
                """
                INSERT INTO figure_embedding_queue (figure_id, source, image_ref, model_version)
                VALUES ($1, 'tags', $2, $3)
                ON CONFLICT (image_ref, model_version) DO UPDATE
                  SET state = 'pending', error_message = NULL, attempts = 0, claimed_at = NULL
                """,
                item["figure_id"],
                f"tagvec:{item['figure_id']}",
                TEXT_MODEL_VERSION,
            )


async def run_tagger_loop(pool: asyncpg.Pool, state: Any) -> None:
    """Drain the tagging jobs: tag each figure's image with WD-Tagger and write
    figures.visual_tags (then store_tags re-embeds its e5 text). A FOURTH
    concurrent worker loop. Best-effort load — skips if the WD model isn't baked
    into this image, without taking the host worker down."""
    model = LazyModel("wd-tagger", TaggerEmbedder.load)
    log.info("tagger loop started", model_version=TAGGER_MODEL_VERSION, server_url=SERVER_URL)
    while True:
        if not getattr(state, "enabled", True):
            model.unload_if_idle(MODEL_IDLE_GRACE)
            await asyncio.sleep(POLL_INTERVAL)
            continue
        item = await claim_next_tags(pool)
        if item is None:
            model.unload_if_idle(MODEL_IDLE_GRACE)
            await asyncio.sleep(POLL_INTERVAL)
            continue
        try:
            tagger = await model.acquire()
        except Exception as e:  # noqa: BLE001
            log.warning("tagger model load failed — releasing item, tagger loop disabled", error=str(e))
            await release_claim(pool, item)
            return
        try:
            imgs = await fetch_figure_all_images(pool, item["figure_id"])
            if not imgs:
                # Figure gone or imageless → nothing to tag; drop the job row.
                async with pool.acquire() as conn:
                    await conn.execute("DELETE FROM figure_embedding_queue WHERE id = $1", item["id"])
                continue
            # Tag every image; MERGE the tags (dedup, first-seen order) so the
            # figure gets the union across all angles. A vanished image (404) is
            # skipped, not fatal — only an all-gone figure drops the job.
            seen: set = set()
            merged: list = []
            for source, ref in imgs:
                try:
                    data = await asyncio.to_thread(fetch_image, source, ref)
                except urllib.error.HTTPError as e:
                    if e.code == 404:
                        continue
                    raise
                tag_str = await asyncio.to_thread(tagger.tag, data)
                for tag in (t.strip() for t in tag_str.split(",")):
                    if tag and tag not in seen:
                        seen.add(tag)
                        merged.append(tag)
            if not merged:
                async with pool.acquire() as conn:
                    await conn.execute("DELETE FROM figure_embedding_queue WHERE id = $1", item["id"])
                continue
            tags = ", ".join(merged)
            await store_tags(pool, item, tags)
            log.info("tagged", figure_id=str(item["figure_id"]), images=len(imgs), tags=tags[:80])
        except Exception as e:  # noqa: BLE001
            trace = traceback.format_exc()[-2000:]
            await mark_failure(pool, item, f"{type(e).__name__}: {e}\n{trace}")


# --- Owned-photo appearance tagging ------------------------------------------
# The user's OWN uploaded photos get the SAME WD-Tagger treatment as catalogue
# images, so they can filter their collection by look. Rides the shared queue
# with source='owned_tags' (image_ref='owned_photo:<photo_id>', figure_id NULL),
# fetched over the server's internal owned-photo route (private images), and
# written back to photos.visual_tags.
async def claim_next_owned_tags(pool: asyncpg.Pool) -> asyncpg.Record | None:
    """Claim a pending OWNED-photo tag job (model_version = wd-tagger-v3/1,
    source='owned_tags', image_ref='owned_photo:<photo_id>'). The owned-photo
    twin of `claim_next_tags`, draining its own disjoint queue rows."""
    async with pool.acquire() as conn:
        return await conn.fetchrow(
            """
            UPDATE figure_embedding_queue
               SET state = 'processing', claimed_at = now(), attempts = attempts + 1
             WHERE id = (
                 SELECT id FROM figure_embedding_queue
                  WHERE state = 'pending' AND model_version = $1 AND source = $2
                  ORDER BY enqueued_at ASC
                  FOR UPDATE SKIP LOCKED
                  LIMIT 1
             )
         RETURNING id, figure_id, source, image_ref, model_version, attempts
            """,
            TAGGER_MODEL_VERSION,
            OWNED_TAGS_SOURCE,
        )


async def store_owned_photo_tags(pool: asyncpg.Pool, item: asyncpg.Record, tags: str) -> None:
    """Write the photo's appearance tags + mark the job done, atomically. Unlike
    catalogue tags there's NO e5 re-embed (owned photos don't feed the catalogue
    semantic index) — the tags exist only to surface + filter the collection."""
    photo_id = item["image_ref"].split(":", 1)[1]
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute(
                "UPDATE photos SET visual_tags = $2 WHERE id = $1::uuid", photo_id, tags
            )
            await conn.execute(
                "UPDATE figure_embedding_queue SET state = 'done', error_message = NULL WHERE id = $1",
                item["id"],
            )


async def run_owned_tagger_loop(pool: asyncpg.Pool, state: Any) -> None:
    """Drain the OWNED-photo tag jobs: tag each user photo with WD-Tagger and
    write photos.visual_tags. The owned-photo twin of `run_tagger_loop` — a FIFTH
    concurrent worker loop sharing the SAME lazily-loaded WD-Tagger model class.
    Best-effort load — skips if the WD model isn't baked into this image, without
    taking the host worker down; also idles if EMBED_WORKER_TOKEN is unset (it
    can't fetch the private photos)."""
    model = LazyModel("wd-tagger-owned", TaggerEmbedder.load)
    log.info("owned-tagger loop started", model_version=TAGGER_MODEL_VERSION, server_url=SERVER_URL)
    while True:
        if not getattr(state, "enabled", True):
            model.unload_if_idle(MODEL_IDLE_GRACE)
            await asyncio.sleep(POLL_INTERVAL)
            continue
        item = await claim_next_owned_tags(pool)
        if item is None:
            model.unload_if_idle(MODEL_IDLE_GRACE)
            await asyncio.sleep(POLL_INTERVAL)
            continue
        try:
            tagger = await model.acquire()
        except Exception as e:  # noqa: BLE001
            log.warning("tagger model load failed — releasing item, owned-tagger loop disabled", error=str(e))
            await release_claim(pool, item)
            return
        try:
            # image_ref is 'owned_photo:<photo_id>' → fetch that one private photo.
            photo_id = item["image_ref"].split(":", 1)[1]
            try:
                data = await asyncio.to_thread(fetch_owned_photo, photo_id)
            except urllib.error.HTTPError as e:
                # 404 = the photo no longer exists → self-heal (drop the job row),
                # not a failure. Anything else is a real error → retry/fail.
                if e.code == 404:
                    async with pool.acquire() as conn:
                        await conn.execute(
                            "DELETE FROM figure_embedding_queue WHERE id = $1", item["id"]
                        )
                    continue
                raise
            tag_str = await asyncio.to_thread(tagger.tag, data)
            # Normalise like the catalogue merge (dedup, first-seen order).
            seen: set = set()
            merged: list = []
            for tag in (t.strip() for t in tag_str.split(",")):
                if tag and tag not in seen:
                    seen.add(tag)
                    merged.append(tag)
            tags = ", ".join(merged)
            await store_owned_photo_tags(pool, item, tags)
            log.info("owned-photo tagged", photo_id=photo_id, tags=tags[:80])
        except Exception as e:  # noqa: BLE001
            trace = traceback.format_exc()[-2000:]
            await mark_failure(pool, item, f"{type(e).__name__}: {e}\n{trace}")

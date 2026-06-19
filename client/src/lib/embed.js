// Client-side image embedding for visual (photo) search — DINOv2-small, 384-d.
//
// The model is SELF-HOSTED under /models/ (so the CSP stays `'self'`), and the
// ONNX Runtime WASM is the same Vite-bundled runtime the background remover
// already ships. The transformers.js library is loaded with a dynamic import
// so its weight never enters the main bundle (mirrors lib/bgRemoval.js).
//
// The catalog index is embedded with the EXACT same model + preprocessing
// (see the worker / dev seed), so the query vector and the catalog vectors
// share one space — `MODEL_VERSION` here must match the server's.

/** Must equal `domain::visual_search::MODEL_VERSION` on the server. */
export const MODEL_VERSION = "dinov2-small/1";
const MODEL_ID = "Xenova/dinov2-small";
export const EMBED_DIM = 384;

let _extractorPromise = null;

/** Lazily load (download + init) the embedding pipeline. Cached after first
 *  call. `onProgress({status, file, progress})` surfaces the one-time model
 *  download so the UI can show a "preparing…" state. */
async function getExtractor(onProgress) {
  if (_extractorPromise) return _extractorPromise;
  _extractorPromise = (async () => {
    const { pipeline, env } = await import("@huggingface/transformers");
    // Never reach out to huggingface.co — the model lives under our origin.
    env.allowRemoteModels = false;
    env.allowLocalModels = true;
    env.localModelPath = "/models/";
    // Self-host the ONNX Runtime WASM too (transformers.js bundles ORT 1.26 and
    // otherwise fetches its .wasm from a CDN, which the strict `connect-src
    // 'self'` CSP blocks). Files live in public/ort/ (jsep for WebGPU, plain
    // for the WASM fallback).
    env.backends.onnx.wasm.wasmPaths = "/ort/";
    const device = hasWebGPU() ? "webgpu" : "wasm";
    return pipeline("image-feature-extraction", MODEL_ID, {
      device,
      dtype: "q8",
      progress_callback: onProgress,
    });
  })();
  return _extractorPromise;
}

/** Warm the model (download + init) ahead of the first capture, so the user
 *  doesn't wait on it after taking the photo. Safe to call repeatedly. */
export function warmUp(onProgress) {
  return getExtractor(onProgress).then(() => true).catch(() => false);
}

/** L2-normalise a vector in place-safe fashion (returns a new array). A zero
 *  vector is returned unchanged to avoid dividing by zero. */
function l2normalize(vec) {
  let sum = 0;
  for (let i = 0; i < vec.length; i++) sum += vec[i] * vec[i];
  const norm = Math.sqrt(sum);
  if (!(norm > 0)) return vec;
  return vec.map((x) => x / norm);
}

/** Embed an image into a 384-d L2-normalised vector, comparable against the
 *  catalog index. Accepts a Blob/File or an image URL (data:/blob:/https:).
 *
 *  Contract with the indexing worker (Phase 5): both sides run DINOv2-small,
 *  take the CLS token of `last_hidden_state` as the global descriptor, and
 *  L2-normalise. Keep these in lockstep — the query and the index must share
 *  one vector space. */
export async function embedImage(source, onProgress) {
  const extractor = await getExtractor(onProgress);
  let input = source;
  let objectUrl = null;
  if (source instanceof Blob) {
    objectUrl = URL.createObjectURL(source);
    input = objectUrl;
  }
  try {
    // NOTE: the `image-feature-extraction` pipeline only honours a `pool`
    // boolean (mean-pool) — unlike the text feature pipeline it ignores
    // `pooling: "cls"` / `normalize`. So it returns the full
    // `last_hidden_state` ([1, tokens, 384] for DINOv2: 1 CLS + 256 patches).
    // We slice the CLS token (row 0) ourselves and normalise below.
    const out = await extractor(input);
    const data = out?.data ?? out;
    const arr = Array.from(data, (x) => Number(x));
    let vec;
    if (arr.length === EMBED_DIM) {
      // Already pooled to a single 384-d vector.
      vec = arr;
    } else if (arr.length % EMBED_DIM === 0 && arr.length > 0) {
      // [tokens, 384] row-major → the CLS token is the first row.
      vec = arr.slice(0, EMBED_DIM);
    } else {
      throw new Error(`unexpected embedding length ${arr.length}`);
    }
    return l2normalize(vec);
  } finally {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}

/** WebGPU availability — used for a UI hint about speed and to decide whether
 *  to nudge the user to wait (WASM is slower on weak devices). */
export function hasWebGPU() {
  return typeof navigator !== "undefined" && !!navigator.gpu;
}

// ── Semantic TEXT search — multilingual-e5-small, 384-d ──────────────────────
//
// Same self-hosted setup as the image model. The `feature-extraction` pipeline
// (unlike `image-feature-extraction`) honours `pooling`/`normalize`, so it
// returns a single mean-pooled, L2-normalised 384-d vector directly.
//
// e5 is a RETRIEVAL model: prefix the text with "query: " for a search query
// and "passage: " for a catalogue document. The caller passes the FULL string
// (prefix included); the worker + dev seed use "passage: ", the search uses
// "query: ". Keep them in lockstep — the query and the index share one space.

/** Must equal `domain::visual_search::TEXT_MODEL_VERSION` on the server. */
export const TEXT_MODEL_VERSION = "e5-small/1";
const TEXT_MODEL_ID = "Xenova/multilingual-e5-small";

let _textExtractorPromise = null;

async function getTextExtractor(onProgress) {
  if (_textExtractorPromise) return _textExtractorPromise;
  _textExtractorPromise = (async () => {
    const { pipeline, env } = await import("@huggingface/transformers");
    env.allowRemoteModels = false;
    env.allowLocalModels = true;
    env.localModelPath = "/models/";
    env.backends.onnx.wasm.wasmPaths = "/ort/";
    const device = hasWebGPU() ? "webgpu" : "wasm";
    return pipeline("feature-extraction", TEXT_MODEL_ID, {
      device,
      dtype: "q8",
      progress_callback: onProgress,
    });
  })();
  return _textExtractorPromise;
}

/** Warm the text model (download + init) ahead of the first semantic search. */
export function warmUpText(onProgress) {
  return getTextExtractor(onProgress)
    .then(() => true)
    .catch(() => false);
}

// --- In-browser query-embedding cache ----------------------------------------
// Query embeddings are deterministic, so a repeated search reuses the cached
// vector and skips the on-device model run — the repeat is near-instant. One
// store per model (e5 "Description" + SigLIP "Apparence"): an LRU Map persisted
// to localStorage, keyed by the query string and versioned by model so a model
// bump drops stale vectors. Each store is capped well under the ~10 MB budget.
//
// NB this caches the WHOLE-query embedding by design. A transformer's sentence
// embedding can't be rebuilt from per-word embeddings (every token attends to
// every other, then we pool), so "elf bleu" after "elf vert" is — correctly —
// a fresh compute, not a recombination of cached words.
function createQueryCache(storeKey, maxEntries) {
  let map = null;
  const load = () => {
    if (map) return map;
    map = new Map();
    try {
      const raw = localStorage.getItem(storeKey);
      if (raw) for (const [k, v] of JSON.parse(raw)) map.set(k, v);
    } catch {
      map = new Map();
    }
    return map;
  };
  const persist = (cache) => {
    try {
      localStorage.setItem(storeKey, JSON.stringify([...cache.entries()]));
    } catch {
      // Storage full/blocked (private mode, quota): trim hard and retry once;
      // failing that, keep the in-memory cache and skip persistence.
      while (cache.size > Math.min(50, maxEntries))
        cache.delete(cache.keys().next().value);
      try {
        localStorage.setItem(storeKey, JSON.stringify([...cache.entries()]));
      } catch {
        /* in-memory only */
      }
    }
  };
  return {
    /** Cached vector for `key` (a copy), touched as most-recently-used; null
     *  if absent. */
    get(key) {
      const cache = load();
      const hit = cache.get(key);
      if (!hit) return null;
      cache.delete(key); // LRU touch: re-insert so it counts as most-recent
      cache.set(key, hit);
      return hit.slice();
    },
    /** Store `vec` under `key`, evict the LRU tail past the cap, persist. */
    set(key, vec) {
      const cache = load();
      cache.set(key, vec);
      while (cache.size > maxEntries) cache.delete(cache.keys().next().value);
      persist(cache);
    },
  };
}

// e5 text (Description) queries — 384-d. ~500 × ~7 KB JSON ≈ 3–4 MB.
const textQueryCache = createQueryCache(`fc:e5qcache:${TEXT_MODEL_VERSION}`, 500);

/** Embed a TEXT string into a 384-d L2-normalised vector (multilingual-e5-small).
 *  Pass the FULL text WITH the e5 prefix: "query: …" for a search query,
 *  "passage: …" for a catalogue document. Identical inputs are served from a
 *  small in-browser LRU cache (no model run, no download).
 *
 *  `onStage(stage)` reports the work phase for a staged loader: "model" while
 *  the model loads (download on first use, else instant), then "local" while
 *  the embedding runs. A cache hit returns before either, so it stays silent. */
export async function embedText(text, onStage) {
  const key = (text ?? "").trim();
  const cached = textQueryCache.get(key);
  if (cached) return cached;
  onStage?.("model");
  const extractor = await getTextExtractor();
  onStage?.("local");
  const out = await extractor(text, { pooling: "mean", normalize: true });
  const data = out?.data ?? out;
  const arr = Array.from(data, (x) => Number(x));
  if (arr.length !== EMBED_DIM) {
    throw new Error(`unexpected text embedding length ${arr.length}`);
  }
  textQueryCache.set(key, arr);
  return arr.slice();
}

// ── Multimodal "search by look" — multilingual SigLIP2-base TEXT tower, 768-d ─
//
// SigLIP shares ONE space for images and text: the worker embeds catalog images
// with the VISION tower, the browser embeds the query with the TEXT tower (here)
// — a description retrieves figures by look. Loaded lazily (only when the user
// opens "Apparence"), self-hosted under /models/ like the others. Unlike e5,
// SigLIP isn't a `feature-extraction` pipeline: it pads to a fixed 64 tokens and
// the sentence vector is the text tower's `pooler_output` (L2-normalised here).

/** Must equal `domain::visual_search::CLIP_MODEL_VERSION` on the server. */
export const CLIP_MODEL_VERSION = "siglip2-base/1";
const CLIP_MODEL_ID = "onnx-community/siglip2-base-patch16-224-ONNX";
const CLIP_EMBED_DIM = 768;
const CLIP_MAX_TOKENS = 64;

// SigLIP text (Apparence) queries — 768-d (≈2× an e5 vector), so a smaller cap
// keeps this store ~3–4 MB, leaving both caches comfortably under ~10 MB.
const clipQueryCache = createQueryCache(
  `fc:siglipqcache:${CLIP_MODEL_VERSION}`,
  250,
);

let _clipTextPromise = null;

async function getClipTextEncoder(onProgress) {
  if (_clipTextPromise) return _clipTextPromise;
  _clipTextPromise = (async () => {
    const { AutoTokenizer, SiglipTextModel, env } = await import(
      "@huggingface/transformers"
    );
    env.allowRemoteModels = false;
    env.allowLocalModels = true;
    env.localModelPath = "/models/";
    env.backends.onnx.wasm.wasmPaths = "/ort/";
    const device = hasWebGPU() ? "webgpu" : "wasm";
    const [tokenizer, model] = await Promise.all([
      AutoTokenizer.from_pretrained(CLIP_MODEL_ID, { progress_callback: onProgress }),
      SiglipTextModel.from_pretrained(CLIP_MODEL_ID, {
        device,
        dtype: "q8",
        progress_callback: onProgress,
      }),
    ]);
    return { tokenizer, model };
  })();
  return _clipTextPromise;
}

/** Warm the SigLIP text tower (≈283 MB) ahead of the first "Apparence" search. */
export function warmUpClipText(onProgress) {
  return getClipTextEncoder(onProgress)
    .then(() => true)
    .catch(() => false);
}

/** Embed a free-text description into a 768-d L2-normalised SigLIP text vector
 *  (the shared image+text space) for multimodal "search by look". Identical
 *  inputs are served from a small in-browser LRU cache (no model run, no
 *  download). `onStage(stage)` reports "model" (load/download) then "local"
 *  (embedding) for a staged loader; a cache hit returns before either. */
export async function embedClipText(text, onStage) {
  const key = (text ?? "").trim();
  const cached = clipQueryCache.get(key);
  if (cached) return cached;
  onStage?.("model");
  const { tokenizer, model } = await getClipTextEncoder();
  onStage?.("local");
  const inputs = tokenizer(text, {
    padding: "max_length",
    max_length: CLIP_MAX_TOKENS,
    truncation: true,
  });
  const out = await model(inputs);
  const data = (out.pooler_output ?? out.text_embeds ?? out.last_hidden_state)?.data;
  if (!data) throw new Error("clip text: model returned no pooled output");
  let arr = Array.from(data, (x) => Number(x));
  if (arr.length !== CLIP_EMBED_DIM) {
    throw new Error(`unexpected clip text embedding length ${arr.length}`);
  }
  const norm = Math.sqrt(arr.reduce((s, x) => s + x * x, 0));
  if (norm > 0) arr = arr.map((x) => x / norm);
  clipQueryCache.set(key, arr);
  return arr.slice();
}

// Diagnostic / seed hooks: expose the embedders so the catalog index can be
// seeded from the browser with the EXACT same model the query uses (the dev
// seed tooling drives these).
if (typeof window !== "undefined") {
  window.__fcEmbedImage = embedImage;
  window.__fcEmbedText = embedText;
  window.__fcEmbedClipText = embedClipText;
}

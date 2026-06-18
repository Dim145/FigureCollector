// Populate the self-hosted ML assets for visual (photo) search.
//
// The DINOv2-small embedder runs IN THE BROWSER (see src/lib/embed.js). To keep
// the CSP at `'self'` (no huggingface.co / CDN origins) we serve both the model
// weights and the ONNX Runtime WASM from our own origin, under public/. Those
// files are large (~97 MB) and are NOT committed to git — this script
// regenerates them, and `pnpm run build` runs it automatically (prebuild hook),
// so a fresh checkout / Docker build is self-contained.
//
//   • ORT WASM   ← copied from the onnxruntime-web that @huggingface/transformers
//                  pulls in (1.26 — has the `asyncify` WebGPU variant; the
//                  top-level onnxruntime-web is @imgly's older 1.21 without it).
//   • Model      ← downloaded from the HuggingFace Hub (Xenova/dinov2-small).
//
// Idempotent: ORT files are re-copied (cheap, local); model files are skipped
// when already present and non-empty.

import { createRequire } from "node:module";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const clientDir = join(here, "..");
const require = createRequire(import.meta.url);

const ORT_OUT = join(clientDir, "public", "ort");
// dtype "q8" (src/lib/embed.js) → the quantised ONNX graph. Image models need
// preprocessor_config; text models need the tokenizer files instead.
const MODELS = [
  {
    id: "Xenova/dinov2-small",
    files: [
      "config.json",
      "preprocessor_config.json",
      "onnx/model_quantized.onnx",
    ],
  },
  {
    // Semantic text search (Batch 4).
    id: "Xenova/multilingual-e5-small",
    files: [
      "config.json",
      "tokenizer.json",
      "tokenizer_config.json",
      "special_tokens_map.json",
      "onnx/model_quantized.onnx",
    ],
  },
  {
    // Multimodal "search by look" (Batch 5) — SigLIP2 TEXT tower only (the
    // worker holds the vision tower). Shared 768-d image+text space; the text
    // ONNX (~283 MB q8) is runtime-cached, loaded only when "Apparence" is used.
    id: "onnx-community/siglip2-base-patch16-224-ONNX",
    files: [
      "config.json",
      "tokenizer.json",
      "tokenizer_config.json",
      "special_tokens_map.json",
      "onnx/text_model_quantized.onnx",
    ],
  },
];

function log(msg) {
  console.log(`[ml-assets] ${msg}`);
}

// ── 1. ONNX Runtime WASM (matches the version transformers.js loads) ──────────
function copyOrtRuntime() {
  const transformersEntry = require.resolve("@huggingface/transformers");
  // Resolve the *transitive* onnxruntime-web (the 1.26 dev build), not the
  // top-level one. Its package.json blocks the `./package.json` subpath, so we
  // resolve the main entry and take its directory (the dist folder).
  const ortMain = require.resolve("onnxruntime-web", {
    paths: [dirname(transformersEntry)],
  });
  const ortDist = dirname(ortMain);
  const files = readdirSync(ortDist).filter((f) =>
    /^ort-wasm-simd-threaded\..*\.(wasm|mjs)$|^ort-wasm-simd-threaded\.(wasm|mjs)$/.test(f),
  );
  if (files.length === 0) {
    throw new Error(`no ort-wasm-simd-threaded.* files found in ${ortDist}`);
  }
  mkdirSync(ORT_OUT, { recursive: true });
  for (const f of files) copyFileSync(join(ortDist, f), join(ORT_OUT, f));
  log(`ORT runtime: copied ${files.length} files from ${ortDist}`);
}

// ── 2. Model weights + preprocessing / tokenizer (HuggingFace Hub) ────────────
async function fetchModel(id, files) {
  const out = join(clientDir, "public", "models", id);
  for (const rel of files) {
    const dest = join(out, rel);
    if (existsSync(dest) && statSync(dest).size > 0) {
      log(`model: ${id}/${rel} already present, skipping`);
      continue;
    }
    mkdirSync(dirname(dest), { recursive: true });
    const url = `https://huggingface.co/${id}/resolve/main/${rel}`;
    const res = await fetch(url);
    if (!res.ok) {
      // Some tokenizer files are optional per model — warn + skip rather than
      // break the build. A genuinely-required missing file surfaces when the
      // model fails to load at runtime.
      log(`model: ${id}/${rel} → HTTP ${res.status}, skipping`);
      continue;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    writeFileSync(dest, buf);
    log(`model: downloaded ${id}/${rel} (${(buf.length / 1024).toFixed(0)} KiB)`);
  }
}

copyOrtRuntime();
for (const m of MODELS) await fetchModel(m.id, m.files);
log("done.");

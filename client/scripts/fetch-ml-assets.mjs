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
const MODEL_ID = "Xenova/dinov2-small";
const MODEL_OUT = join(clientDir, "public", "models", MODEL_ID);
// dtype "q8" (src/lib/embed.js) → the quantised ONNX graph.
const MODEL_FILES = [
  "config.json",
  "preprocessor_config.json",
  "onnx/model_quantized.onnx",
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

// ── 2. Model weights + preprocessing (HuggingFace Hub) ────────────────────────
async function fetchModel() {
  for (const rel of MODEL_FILES) {
    const dest = join(MODEL_OUT, rel);
    if (existsSync(dest) && statSync(dest).size > 0) {
      log(`model: ${rel} already present, skipping`);
      continue;
    }
    mkdirSync(dirname(dest), { recursive: true });
    const url = `https://huggingface.co/${MODEL_ID}/resolve/main/${rel}`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`fetch ${url} → HTTP ${res.status}`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    writeFileSync(dest, buf);
    log(`model: downloaded ${rel} (${(buf.length / 1024).toFixed(0)} KiB)`);
  }
}

copyOrtRuntime();
await fetchModel();
log("done.");

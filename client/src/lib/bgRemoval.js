// Lazy wrapper around @imgly/background-removal.
//
// The library itself is ~50 KB of JS code, but it downloads an ONNX model on
// first use (40 / 80 / 120 MB depending on size). The model is cached in the
// browser's HTTP cache and the service-worker runtime cache, so subsequent
// runs only pay the model-load CPU time.
//
// We dynamic-import the library so it never lands in the main bundle.

import { getPref } from "./userPrefs.js";

/**
 * Remove the background from `blob`. Returns a new Blob (PNG with alpha).
 *
 * @param {Blob | File} blob
 * @param {(progress: { key: string, current: number, total: number }) => void} [onProgress]
 *   Called with download / inference progress. Use to drive a loading bar.
 * @returns {Promise<Blob>}
 */
export async function removeBackground(blob, onProgress) {
  const mod = await import("@imgly/background-removal");
  const model = getPref("bgModel"); // "small" | "medium" | "large"

  // imgly maps "small"/"medium"/"large" to "isnet_quint8" / "isnet" / "isnet_fp16".
  // We stay on the public string API so it stays compatible across upgrades.
  return mod.removeBackground(blob, {
    model,
    output: { format: "image/png", quality: 0.92 },
    progress: onProgress,
  });
}

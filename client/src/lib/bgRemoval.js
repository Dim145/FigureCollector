// In-browser background removal — BiRefNet (MIT) via transformers.js.
//
// Why not @imgly/background-removal (the previous implementation):
//   1. **Licence** — the library is AGPL-3.0 while this repository is MIT.
//   2. **Privacy / CSP** — it fetched ~80 MB of ONNX + WASM from
//      `staticimgly.com` on first use, so "remove the background" phoned a
//      third-party CDN on every fresh cache and forced that host into
//      `connect-src`. On a filtered LAN it simply failed.
//   3. **Quality** — it runs ISNet; BiRefNet is the stronger model on hair,
//      thin accessories and translucent parts, which is exactly what figure
//      photos are made of.
//
// BiRefNet_lite-ONNX is MIT, runs on the ORT WASM/WebGPU runtime this app
// already self-hosts for visual search, and its weights are fetched at build
// time into `public/models/` (see scripts/fetch-ml-assets.mjs) — so the feature
// works offline, same-origin, with no CDN allowance.

/** Cached model + processor — loading them is the expensive part, not inference. */
let loaded = null;

async function load(onProgress) {
  if (loaded) return loaded;
  const { AutoModel, AutoProcessor, env } = await import("@huggingface/transformers");

  // Same self-hosted setup as src/lib/embed.js: never reach for the Hub.
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  env.localModelPath = "/models/";
  env.backends.onnx.wasm.wasmPaths = "/ort/";

  const id = "onnx-community/BiRefNet_lite-ONNX";
  // fp16 halves the download and is what WebGPU wants; the WASM path reads it
  // fine too. There is no q8 export of this graph upstream.
  const dtype = "fp16";
  const device = typeof navigator !== "undefined" && navigator.gpu ? "webgpu" : "wasm";

  const [model, processor] = await Promise.all([
    AutoModel.from_pretrained(id, { dtype, device, progress_callback: onProgress }),
    AutoProcessor.from_pretrained(id),
  ]);
  loaded = { model, processor, RawImage: (await import("@huggingface/transformers")).RawImage };
  return loaded;
}

/**
 * Remove the background from `blob`. Returns a new PNG Blob with alpha.
 *
 * @param {Blob | File} blob
 * @param {(p: { status?: string, progress?: number }) => void} [onProgress]
 *   Model-download / load progress, for a loading bar.
 * @returns {Promise<Blob>}
 */
export async function removeBackground(blob, onProgress) {
  const { model, processor, RawImage } = await load(onProgress);

  const image = await RawImage.fromBlob(blob);
  const { pixel_values } = await processor(image);
  const { output_image } = await model({ input_image: pixel_values });

  // The model emits a single-channel logit map; sigmoid → alpha, then back up
  // to the source resolution so we never downscale the user's photo.
  const mask = await RawImage.fromTensor(
    output_image[0].sigmoid().mul(255).to("uint8"),
  ).resize(image.width, image.height);

  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image.toCanvas(), 0, 0);

  // Paint the mask into the alpha channel, leaving RGB untouched — compositing
  // with `destination-in` would re-encode colour on some engines.
  const pixels = ctx.getImageData(0, 0, image.width, image.height);
  for (let i = 0; i < mask.data.length; i++) {
    pixels.data[4 * i + 3] = mask.data[i];
  }
  ctx.putImageData(pixels, 0, 0);

  return await new Promise((resolve, reject) =>
    canvas.toBlob(
      (out) => (out ? resolve(out) : reject(new Error("canvas.toBlob returned null"))),
      "image/png",
    ),
  );
}

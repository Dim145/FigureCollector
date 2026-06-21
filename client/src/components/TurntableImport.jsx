import { useEffect, useRef, useState } from "react";
import { useT } from "../i18n/index.jsx";
import Button from "./Button.jsx";

/**
 * Multi-file import: pick 6-96 still images, re-encode each as WebP before
 * passing them up (keeps the upload payload predictable + strips EXIF).
 *
 * Safari < 16.4 doesn't ship `OffscreenCanvas.convertToBlob`, so we
 * feature-detect and fall back to the on-DOM `<canvas>.toBlob` path
 * (one extra reflow per frame; not worth optimising for an older
 * browser tier).
 */
export default function TurntableImport({ onComplete }) {
  const t = useT();
  const [frames, setFrames] = useState([]);
  const [previews, setPreviews] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // Revoke every blob URL we own at unmount — otherwise dozens of large WebP
  // blobs leak each time the user navigates away mid-import. Mirror `previews`
  // into a ref so this unmount-only cleanup revokes the CURRENT list: closing
  // over `previews` directly captured the initial `[]` (empty deps never re-run
  // the effect) and revoked nothing. The setter still revokes the OLD list on
  // re-import.
  const previewsRef = useRef(previews);
  // Keep the ref current in an effect (writing it during render trips
  // react-hooks/refs). The empty-deps cleanup below then revokes the latest
  // committed list at unmount.
  useEffect(() => {
    previewsRef.current = previews;
  }, [previews]);
  useEffect(() => () => previewsRef.current.forEach((u) => URL.revokeObjectURL(u)), []);

  const onChange = async (e) => {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    setBusy(true);
    setError(null);
    try {
      const blobs = [];
      const urls = [];
      for (const f of files.slice(0, 96)) {
        const blob = await reencodeToWebP(f);
        blobs.push(blob);
        urls.push(URL.createObjectURL(blob));
      }
      setFrames(blobs);
      setPreviews((old) => {
        old.forEach((u) => URL.revokeObjectURL(u));
        return urls;
      });
    } catch (err) {
      // Without this the file dialog gave the impression of being broken:
      // on Safari < 16.4 the `convertToBlob` throw bubbled out of `onChange`
      // unhandled and the user just saw a stuck "Préparation…" forever.
      setError(err?.message || String(err));
    } finally {
      setBusy(false);
      // Allow re-picking the same file after we report an error.
      e.target.value = "";
    }
  };

  return (
    <div className="p-8 h-full overflow-y-auto">
      <label className="block">
        <input
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp"
          onChange={onChange}
          className="hidden"
        />
        <div className="border-2 border-dashed border-[var(--color-or)]/30 hover:border-[var(--color-or)]/60 transition-colors p-12 text-center cursor-pointer">
          <p className="display text-2xl text-[var(--color-ivoire)]">
            {t("turntable.import.cta")}
          </p>
          <p className="micro mt-3">{t("turntable.import.hint")}</p>
        </div>
      </label>

      {error ? (
        <p
          role="alert"
          className="micro mt-6 text-center text-[var(--color-laque-bright)]"
        >
          {error}
        </p>
      ) : busy ? (
        <p className="micro mt-6 text-center">{t("turntable.import.preparing")}</p>
      ) : previews.length > 0 ? (
        <>
          <p className="micro mt-6">
            {t("turntable.import.collected", { n: previews.length })}
          </p>
          <ul className="mt-3 grid grid-cols-6 sm:grid-cols-8 gap-2">
            {previews.map((url, i) => (
              <li key={url} className="aspect-square bg-[var(--color-noir)] border border-[var(--color-or)]/15 overflow-hidden">
                <img
                  src={url}
                  alt={t("turntable.import.frame_alt", { n: i + 1, default: `Frame ${i + 1}` })}
                  loading="lazy"
                  decoding="async"
                  className="w-full h-full object-cover"
                />
              </li>
            ))}
          </ul>
          <div className="mt-6 flex justify-end">
            <Button
              type="button"
              disabled={frames.length < 6}
              onClick={() => onComplete(frames)}
              size="sm"
              className="uppercase tracking-[0.18em]"
            >
              {t("turntable.save")}
            </Button>
          </div>
        </>
      ) : null}
    </div>
  );
}

/**
 * Re-encode a picked file to WebP at ≤1920px on the longest side.
 *
 * Prefers `OffscreenCanvas.convertToBlob` (modern, doesn't pollute the
 * DOM with a hidden <canvas>). Falls back to a transient on-DOM canvas
 * for Safari < 16.4 + WebKit GTK builds that don't ship convertToBlob.
 */
async function reencodeToWebP(file) {
  const bitmap = await createImageBitmap(file);
  try {
    const max = 1920;
    const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);

    // Feature-detect first — `typeof OffscreenCanvas.prototype.convertToBlob`
    // is `"function"` on Chrome / Firefox / Safari 16.4+ and `"undefined"`
    // on Safari < 16.4.
    const canOffscreen =
      typeof OffscreenCanvas !== "undefined" &&
      typeof OffscreenCanvas.prototype.convertToBlob === "function";

    if (canOffscreen) {
      const canvas = new OffscreenCanvas(w, h);
      canvas.getContext("2d").drawImage(bitmap, 0, 0, w, h);
      return await canvas.convertToBlob({ type: "image/webp", quality: 0.85 });
    }

    // Fallback: on-DOM canvas + toBlob.
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d").drawImage(bitmap, 0, 0, w, h);
    return await new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) =>
          blob
            ? resolve(blob)
            : reject(new Error("canvas.toBlob returned null (WebP unsupported)")),
        "image/webp",
        0.85,
      );
    });
  } finally {
    bitmap.close?.();
  }
}

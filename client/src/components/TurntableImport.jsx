import { useState } from "react";
import { useT } from "../i18n/index.jsx";

/**
 * Multi-file import: pick 6-96 still images, re-encode each as WebP before
 * passing them up (keeps the upload payload predictable + strips EXIF).
 */
export default function TurntableImport({ onComplete }) {
  const t = useT();
  const [frames, setFrames] = useState([]);
  const [previews, setPreviews] = useState([]);
  const [busy, setBusy] = useState(false);

  const onChange = async (e) => {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    setBusy(true);
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
    setBusy(false);
    e.target.value = "";
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

      {busy ? (
        <p className="micro mt-6 text-center">{t("turntable.import.preparing")}</p>
      ) : previews.length > 0 ? (
        <>
          <p className="micro mt-6">
            {t("turntable.import.collected", { n: previews.length })}
          </p>
          <ul className="mt-3 grid grid-cols-6 sm:grid-cols-8 gap-2">
            {previews.map((url, i) => (
              <li key={i} className="aspect-square bg-[var(--color-noir)] border border-[var(--color-or)]/15 overflow-hidden">
                <img src={url} alt="" className="w-full h-full object-cover" />
              </li>
            ))}
          </ul>
          <div className="mt-6 flex justify-end">
            <button
              type="button"
              disabled={frames.length < 6}
              onClick={() => onComplete(frames)}
              className="px-5 py-3 bg-[var(--color-or)] text-[var(--color-noir)] text-[11px] uppercase tracking-[0.18em] disabled:opacity-40"
            >
              {t("turntable.save")}
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}

async function reencodeToWebP(file) {
  const bitmap = await createImageBitmap(file);
  // Cap longest side at 1920 to keep the scan reasonable in size + memory.
  const max = 1920;
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = new OffscreenCanvas(w, h);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  return canvas.convertToBlob({ type: "image/webp", quality: 0.85 });
}

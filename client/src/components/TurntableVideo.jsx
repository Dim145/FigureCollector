import { useRef, useState } from "react";
import { useT } from "../i18n/index.jsx";

/**
 * Video-to-frames extraction. The user picks a video file (or records one
 * with the system camera). We then sample N evenly-spaced frames via
 * HTMLVideoElement seek + canvas. Everything stays in the browser.
 */
export default function TurntableVideo({ onComplete }) {
  const t = useT();
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [file, setFile] = useState(null);
  const [previews, setPreviews] = useState([]);
  const [frames, setFrames] = useState([]);
  const [target, setTarget] = useState(24);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState(null);

  const onFile = (e) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    cleanup();
    setFile(f);
    setError(null);
  };

  const cleanup = () => {
    previews.forEach((u) => URL.revokeObjectURL(u));
    setPreviews([]);
    setFrames([]);
  };

  const extract = async () => {
    setBusy(true);
    setProgress(0);
    setError(null);
    cleanup();

    try {
      const video = videoRef.current;
      const url = URL.createObjectURL(file);
      video.src = url;
      await new Promise((res, rej) => {
        video.onloadedmetadata = res;
        video.onerror = () => rej(new Error("could not decode video"));
      });

      const duration = video.duration;
      if (!Number.isFinite(duration) || duration <= 0) {
        throw new Error("invalid video duration");
      }

      const canvas = canvasRef.current;
      const w = Math.min(1920, video.videoWidth);
      const h = Math.round((w / video.videoWidth) * video.videoHeight);
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");

      const blobs = [];
      const urls = [];
      // Skip the first and last 1% (often blurry hand-on/off frames).
      const start = duration * 0.01;
      const end = duration * 0.99;
      const step = (end - start) / target;
      for (let i = 0; i < target; i++) {
        const t = start + step * i;
        video.currentTime = t;
        await new Promise((res) => {
          video.onseeked = res;
        });
        ctx.drawImage(video, 0, 0, w, h);
        const blob = await new Promise((res) =>
          canvas.toBlob(res, "image/webp", 0.85),
        );
        if (blob) {
          blobs.push(blob);
          urls.push(URL.createObjectURL(blob));
        }
        setProgress(Math.round(((i + 1) / target) * 100));
      }

      URL.revokeObjectURL(url);
      setFrames(blobs);
      setPreviews(urls);
    } catch (e) {
      setError(e?.message ?? "extraction failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-8 h-full overflow-y-auto">
      <video ref={videoRef} className="hidden" muted playsInline />
      <canvas ref={canvasRef} className="hidden" />

      {!file ? (
        <label className="block">
          <input
            type="file"
            accept="video/*"
            capture="environment"
            onChange={onFile}
            className="hidden"
          />
          <div className="border-2 border-dashed border-[var(--color-or)]/30 hover:border-[var(--color-or)]/60 transition-colors p-12 text-center cursor-pointer">
            <p className="display text-2xl text-[var(--color-ivoire)]">
              {t("turntable.video.cta")}
            </p>
            <p className="micro mt-3">{t("turntable.video.hint")}</p>
          </div>
        </label>
      ) : (
        <div className="space-y-6">
          <p className="micro">
            {t("turntable.video.picked", { name: file.name })}
          </p>

          <div className="flex items-center gap-3 text-[10px] uppercase tracking-[0.18em] text-[var(--color-ivoire-soft)]">
            <span>{t("turntable.target")}</span>
            {[12, 24, 36, 48].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setTarget(n)}
                className={`px-2 py-0.5 transition-colors ${
                  target === n
                    ? "text-[var(--color-or)] border-b border-[var(--color-or)]"
                    : "hover:text-[var(--color-or-pale)]"
                }`}
              >
                {n}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={extract}
            disabled={busy}
            className="px-5 py-3 border border-[var(--color-or)] text-[var(--color-or)] hover:bg-[var(--color-or)]/10 text-[11px] uppercase tracking-[0.18em] disabled:opacity-40"
          >
            {busy
              ? t("turntable.video.extracting", { p: progress })
              : t("turntable.video.extract")}
          </button>

          {error ? (
            <p role="alert" className="text-sm text-[var(--color-laque-bright)]">
              {error}
            </p>
          ) : null}

          {previews.length > 0 ? (
            <>
              <ul className="grid grid-cols-6 sm:grid-cols-8 gap-2">
                {previews.map((url, i) => (
                  <li
                    key={i}
                    className="aspect-square bg-[var(--color-noir)] border border-[var(--color-or)]/15 overflow-hidden"
                  >
                    <img src={url} alt="" className="w-full h-full object-cover" />
                  </li>
                ))}
              </ul>
              <div className="flex justify-end">
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
      )}
    </div>
  );
}

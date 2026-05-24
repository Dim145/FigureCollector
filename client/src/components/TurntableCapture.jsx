import { useEffect, useRef, useState } from "react";
import { useT } from "../i18n/index.jsx";

const TARGET = 24;

// Match TurntableVideo: server rejects > 2048 px per side, keep a margin.
// Downscale the longest side so portrait phone sensors (often 4K) fit too.
const MAX_FRAME_DIM = 1920;

/**
 * Live-camera capture: shoot one frame at a time, the app tells the user how
 * much to rotate the figurine between shots. Phones-first (uses environment
 * camera by default).
 */
export default function TurntableCapture({ onComplete }) {
  const t = useT();
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [stream, setStream] = useState(null);
  const [error, setError] = useState(null);
  const [frames, setFrames] = useState([]);
  const [target, setTarget] = useState(TARGET);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 } },
          audio: false,
        });
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        setStream(s);
        if (videoRef.current) {
          videoRef.current.srcObject = s;
        }
      } catch (e) {
        setError(e?.message ?? "camera unavailable");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (stream) stream.getTracks().forEach((t) => t.stop());
    };
  }, [stream]);

  const snap = async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return;
    const scale = Math.min(1, MAX_FRAME_DIM / Math.max(vw, vh));
    const w = Math.round(vw * scale);
    const h = Math.round(vh * scale);
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d").drawImage(video, 0, 0, w, h);
    const blob = await new Promise((res) => canvas.toBlob(res, "image/webp", 0.85));
    if (blob) setFrames((f) => [...f, blob]);
  };

  const undo = () => setFrames((f) => f.slice(0, -1));
  const finish = () => onComplete(frames);
  const percentRotated = Math.min(100, Math.round((frames.length / target) * 100));
  const nextAngle = (frames.length * 360) / target;

  if (error) {
    return (
      <div className="p-8 text-center">
        <p className="text-[var(--color-laque-bright)]">{t("turntable.camera_error")}</p>
        <p className="text-sm text-[var(--color-ivoire-soft)] mt-2">{error}</p>
      </div>
    );
  }

  return (
    <div className="relative h-full flex flex-col">
      {/* Preview */}
      <div className="relative flex-1 bg-black grid place-items-center overflow-hidden">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="w-full h-full object-contain"
        />
        <canvas ref={canvasRef} className="hidden" />

        {/* Centre guide */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 grid place-items-center"
        >
          <div className="w-2/3 h-2/3 border-2 border-[var(--color-or)]/30 border-dashed rounded-full" />
        </div>

        {/* Angle hint */}
        <div className="absolute top-3 left-1/2 -translate-x-1/2 px-4 py-1 text-[10px] uppercase tracking-[0.22em] text-[var(--color-or)] border border-[var(--color-or)]/40 bg-[var(--color-noir)]/70">
          {t("turntable.next_angle", { deg: Math.round(nextAngle) })}
        </div>
      </div>

      {/* Control bar */}
      <div className="px-4 py-4 border-t border-[var(--color-or)]/20 bg-[var(--color-noir-soft)]/80">
        <div className="flex items-center gap-4">
          <div className="flex-1">
            <div className="h-px bg-[var(--color-or)]/15">
              <div
                className="h-px bg-[var(--color-or)] transition-[width]"
                style={{ width: `${percentRotated}%` }}
              />
            </div>
            <p className="micro mt-2">
              {t("turntable.count", { n: frames.length, target })}
            </p>
          </div>

          <button
            type="button"
            onClick={undo}
            disabled={frames.length === 0}
            aria-label={t("turntable.undo")}
            className="text-[var(--color-ivoire-soft)] hover:text-[var(--color-laque-bright)] disabled:opacity-30 px-3 py-2 text-xl leading-none"
          >
            ↶
          </button>

          <button
            type="button"
            onClick={snap}
            aria-label={t("turntable.snap")}
            className="w-16 h-16 rounded-full border-2 border-[var(--color-or)] bg-[var(--color-or)]/10 hover:bg-[var(--color-or)]/30 active:scale-95 transition-all"
          >
            <span className="block w-10 h-10 rounded-full bg-[var(--color-or)] mx-auto" />
          </button>

          <button
            type="button"
            onClick={finish}
            disabled={frames.length < 6}
            className="px-5 py-3 bg-[var(--color-or)] text-[var(--color-noir)] text-[11px] uppercase tracking-[0.18em] disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {t("turntable.save")}
          </button>
        </div>

        <div className="mt-3 flex items-center gap-3 text-[10px] uppercase tracking-[0.18em] text-[var(--color-ivoire-soft)]">
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
      </div>
    </div>
  );
}

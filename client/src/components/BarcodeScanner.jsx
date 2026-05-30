import { useEffect, useRef, useState } from "react";
import { useT } from "../i18n/index.jsx";

/**
 * Camera barcode scanner (JAN/EAN/UPC) for the figure box.
 *
 * Uses the native `BarcodeDetector` (Chrome / Brave / Android Chrome) against a
 * rear-camera stream. When the API is missing (notably iOS Safari), or camera
 * access is denied, it falls back to a manual barcode input — so the flow never
 * dead-ends. On a hit it calls `onDetect(code)` (digits only) and the parent
 * decides what to do (look up the catalogue, then route).
 *
 * Deliberately dependency-free: no wasm/ZXing bundle, no CDN fetch — which keeps
 * it aligned with the self-hosted, strict-CSP posture. The camera is permitted
 * by `Permissions-Policy: camera=(self)` in the frontend nginx config.
 *
 * @param {{ onDetect: (code: string) => void, onClose: () => void }} props
 */
const FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e"];

export default function BarcodeScanner({ onDetect, onClose }) {
  const t = useT();
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const rafRef = useRef(0);
  const detectedRef = useRef(false);
  const [status, setStatus] = useState("init"); // init | scanning | unsupported | denied | error
  const [manual, setManual] = useState("");

  useEffect(() => {
    const supported =
      typeof window !== "undefined" && "BarcodeDetector" in window;
    if (!supported) {
      setStatus("unsupported");
      return undefined;
    }

    let detector;
    try {
      detector = new window.BarcodeDetector({ formats: FORMATS });
    } catch {
      setStatus("unsupported");
      return undefined;
    }

    const stop = () => {
      cancelAnimationFrame(rafRef.current);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((tr) => tr.stop());
        streamRef.current = null;
      }
    };
    const hit = (code) => {
      if (detectedRef.current) return;
      detectedRef.current = true;
      stop();
      onDetect(code);
    };

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false })
      .then((stream) => {
        if (detectedRef.current) {
          stream.getTracks().forEach((tr) => tr.stop());
          return;
        }
        streamRef.current = stream;
        const v = videoRef.current;
        if (v) {
          v.srcObject = stream;
          v.play().catch(() => {});
        }
        setStatus("scanning");
        const tick = async () => {
          if (detectedRef.current || !videoRef.current) return;
          try {
            const codes = await detector.detect(videoRef.current);
            const found = codes.find(
              (c) => c.rawValue && /^\d{8,14}$/.test(c.rawValue),
            );
            if (found) {
              hit(found.rawValue);
              return;
            }
          } catch {
            /* transient decode error — keep looping */
          }
          rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
      })
      .catch((e) => {
        setStatus(e?.name === "NotAllowedError" ? "denied" : "error");
      });

    return stop;
    // onDetect is provided as a stable callback by the parent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submitManual = (e) => {
    e.preventDefault();
    const code = manual.trim();
    if (/^\d{6,14}$/.test(code)) onDetect(code);
  };

  const showManual = status !== "scanning" && status !== "init";

  return (
    <div
      role="dialog"
      aria-modal
      aria-label={t("scan.title")}
      onClick={onClose}
      className="fixed inset-0 z-50 grid place-items-center bg-[var(--color-noir)]/85 backdrop-blur-sm p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-[95vw] max-w-sm bg-[var(--color-noir-soft)] border border-[var(--color-jade)]/40 frame-corners"
        style={{ boxShadow: "0 60px 120px -50px rgba(0,0,0,0.85)" }}
      >
        <header className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-jade)]/20">
          <div>
            <p className="micro-tight" style={{ color: "var(--color-jade)" }}>
              掃 · {t("scan.eyebrow")}
            </p>
            <h2 className="display text-xl text-[var(--color-ivoire)] mt-0.5">
              {t("scan.title")}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("editor.cancel")}
            className="text-[var(--color-ivoire-soft)] hover:text-[var(--color-jade)] text-xl leading-none px-2"
          >
            ✕
          </button>
        </header>

        <div className="p-5">
          {/* Viewfinder — only while a stream is live */}
          {(status === "init" || status === "scanning") ? (
            <div className="relative aspect-[3/4] bg-[var(--color-noir-deep)] overflow-hidden mb-4">
              <video
                ref={videoRef}
                playsInline
                muted
                className="absolute inset-0 w-full h-full object-cover"
              />
              <div className="absolute inset-0 grid place-items-center pointer-events-none">
                <div className="w-[78%] h-[30%] border-2 border-[var(--color-jade)] rounded-md" style={{ boxShadow: "0 0 0 9999px oklch(0 0 0 / 0.35)" }} />
              </div>
              <p className="absolute bottom-3 left-0 right-0 text-center text-[10px] uppercase tracking-[0.18em]" style={{ color: "var(--color-jade)" }}>
                {status === "scanning" ? t("scan.aim") : t("scan.starting")}
              </p>
            </div>
          ) : null}

          {status === "unsupported" ? (
            <p className="text-sm text-[var(--color-ivoire-soft)] mb-4 leading-relaxed">
              {t("scan.unsupported")}
            </p>
          ) : null}
          {status === "denied" ? (
            <p className="text-sm text-[var(--color-laque-bright)] mb-4 leading-relaxed">
              {t("scan.denied")}
            </p>
          ) : null}
          {status === "error" ? (
            <p className="text-sm text-[var(--color-laque-bright)] mb-4 leading-relaxed">
              {t("scan.error")}
            </p>
          ) : null}

          {/* Manual fallback — always offered once the camera path isn't running */}
          {showManual ? (
            <form onSubmit={submitManual} className="flex flex-col gap-3">
              <label className="micro block">{t("scan.manual")}</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  inputMode="numeric"
                  value={manual}
                  onChange={(e) => setManual(e.target.value.replace(/[^\d]/g, ""))}
                  placeholder={t("scan.manual_ph")}
                  className="flex-1 bg-[var(--color-noir)] border border-[var(--color-or)]/30 px-3 py-2 text-[var(--color-ivoire)] font-mono outline-none focus:border-[var(--color-or)]"
                  autoFocus
                />
                <button
                  type="submit"
                  disabled={!/^\d{6,14}$/.test(manual.trim())}
                  className="px-4 py-2 bg-[var(--color-or)] text-[var(--color-noir)] text-[11px] uppercase tracking-[0.16em] disabled:opacity-40"
                >
                  {t("scan.lookup")}
                </button>
              </div>
            </form>
          ) : null}
        </div>
      </div>
    </div>
  );
}

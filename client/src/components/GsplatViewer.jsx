import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "../i18n/index.jsx";

/**
 * Real 3D viewer for Gaussian Splatting `.ply` results (Phase 5B).
 *
 * Uses the `gsplat` npm package (purpose-built WebGL renderer for 3DGS, no
 * three.js peer dependency). Dynamic-imported so the chunk only ships when
 * a user actually opens a gsplat scan.
 */
export default function GsplatViewer({ scanId, embedded = false }) {
  const t = useT();
  const canvasRef = useRef(null);
  const cleanupRef = useRef(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  // Fullscreen overlay. `embedded` instances (the ones rendered *inside* the
  // overlay) never re-open it — matches the TurntableViewer pattern.
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    if (!fullscreen) return undefined;
    const onKey = (e) => { if (e.key === "Escape") setFullscreen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreen]);

  useEffect(() => {
    let cancelled = false;
    let raf = 0;

    (async () => {
      try {
        const gsplat = await import("gsplat");
        if (cancelled || !canvasRef.current) return;

        const canvas = canvasRef.current;
        const renderer = new gsplat.WebGLRenderer(canvas);
        const scene = new gsplat.Scene();
        const camera = new gsplat.Camera();
        const controls = new gsplat.OrbitControls(camera, canvas);

        // gsplat's PLYLoader.LoadAsync fetches the URL from inside its own
        // web worker, whose request doesn't carry our session cookie (and can
        // be served a stale error by the service worker) → 403 on private
        // scans. Fetch the PLY ourselves on the main thread — authenticated
        // and bypassing the SW cache — then hand the buffer to the parser.
        const res = await fetch(`/api/scans/${scanId}/splat`, {
          credentials: "include",
          cache: "no-store",
        });
        if (!res.ok) {
          throw new Error(`${res.status} ${res.statusText}`.trim());
        }
        const buf = await res.arrayBuffer();
        if (cancelled || !canvasRef.current) {
          renderer.dispose?.();
          return;
        }
        gsplat.PLYLoader.LoadFromArrayBuffer(buf, scene);

        const handleResize = () => {
          const { clientWidth, clientHeight } = canvas;
          renderer.setSize(clientWidth, clientHeight);
        };
        handleResize();
        const ro = new ResizeObserver(handleResize);
        ro.observe(canvas);

        const tick = () => {
          controls.update();
          renderer.render(scene, camera);
          raf = requestAnimationFrame(tick);
        };
        tick();
        setLoading(false);

        cleanupRef.current = () => {
          cancelAnimationFrame(raf);
          ro.disconnect();
          renderer.dispose?.();
        };
      } catch (e) {
        if (!cancelled) {
          setError(e?.message ?? "viewer error");
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      try {
        cleanupRef.current?.();
        cleanupRef.current = null;
      } catch {
        /* ignore */
      }
    };
  }, [scanId]);

  const stage = (
    <div className="relative aspect-square w-full bg-[var(--color-noir)] border border-[var(--color-or)]/20 overflow-hidden">
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full block touch-none"
        aria-label="Gaussian Splatting 3D viewer"
      />
      {loading && !error ? (
        <div className="absolute inset-0 grid place-items-center pointer-events-none">
          <p className="micro animate-pulse">{t("gsplat.loading")}</p>
        </div>
      ) : null}
      {error ? (
        <div className="absolute inset-0 grid place-items-center p-4 text-center">
          <p className="text-sm text-[var(--color-laque-bright)]">{error}</p>
        </div>
      ) : null}
      {/* Fullscreen toggle — only on the inline instance (not the one already
          rendered inside the overlay). */}
      {!embedded && !error ? (
        <button
          type="button"
          onClick={() => setFullscreen(true)}
          // gsplat's OrbitControls listens on the canvas (not the container),
          // so the button doesn't *need* stopPropagation — but defensive in
          // case the listener wiring ever changes.
          onPointerDown={(e) => e.stopPropagation()}
          title={t("turntable.viewer.fullscreen")}
          aria-label={t("turntable.viewer.fullscreen")}
          className="absolute top-2 right-2 z-10 w-9 h-9 grid place-items-center bg-[var(--color-noir)]/70 border border-[var(--color-or)]/40 text-[var(--color-or-pale)] hover:text-[var(--color-or)] hover:border-[var(--color-or)] transition-colors"
        >
          ⛶
        </button>
      ) : null}
    </div>
  );

  if (embedded) return stage;

  return (
    <>
      {stage}
      {fullscreen && typeof document !== "undefined"
        ? createPortal(
            <div
              role="dialog"
              aria-modal="true"
              aria-label={t("turntable.viewer.fullscreen")}
              onClick={() => setFullscreen(false)}
              className="fixed inset-0 z-50 grid place-items-center bg-[var(--color-noir)]/95 backdrop-blur-sm p-4"
            >
              <div
                onClick={(e) => e.stopPropagation()}
                style={{ width: "min(88vmin, 960px)", height: "min(88vmin, 960px)" }}
              >
                <GsplatViewer scanId={scanId} embedded />
              </div>
              <button
                type="button"
                onClick={() => setFullscreen(false)}
                aria-label={t("editor.cancel")}
                className="tap-target absolute top-4 right-4 text-[var(--color-ivoire-soft)] hover:text-[var(--color-or)] text-3xl leading-none transition-colors"
              >
                ×
              </button>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

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

// Module-level cache of fetched PLY buffers, keyed by scanId. Opening the
// fullscreen overlay mounts a SECOND viewer instance, and the inline one
// re-inits when it closes — without this they'd each re-download the (multi-MB)
// model. Bounded to the few most-recent scans to cap memory.
const PLY_CACHE = new Map();
const PLY_CACHE_MAX = 4;
function cachePly(scanId, buf) {
  PLY_CACHE.set(scanId, buf);
  if (PLY_CACHE.size > PLY_CACHE_MAX) {
    PLY_CACHE.delete(PLY_CACHE.keys().next().value);
  }
}

// Robustly bound the figure for framing. A gsplat `.ply` from COLMAP sits in
// COLMAP's arbitrary frame — NOT centred on the origin — so the orbit must point
// at the figure, not the origin. Build a robust bounding box (clip the 2%/98%
// tails per axis so a few far floaters don't dictate the framing): its centre is
// the orbit target, and half its largest side (`rBound`) is the figure's
// limiting half-extent (e.g. a tall figure's height). The camera DISTANCE is
// derived from rBound + the camera's FOV at render time (see useEffect), not
// here — gsplat's focal length is fixed, so the FOV depends on the canvas size.
function frameSplat(scene, gsplat) {
  const fallback = { center: new gsplat.Vector3(0, 0, 0), rBound: 1 };
  const splat = scene.findObjectOfType?.(gsplat.Splat);
  const pos = splat?.data?.positions;
  if (!pos || pos.length < 3) return fallback;
  const n = pos.length / 3;
  const xs = new Float32Array(n);
  const ys = new Float32Array(n);
  const zs = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    xs[i] = pos[3 * i];
    ys[i] = pos[3 * i + 1];
    zs[i] = pos[3 * i + 2];
  }
  xs.sort();
  ys.sort();
  zs.sort();
  const lo = Math.floor(n * 0.02);
  const hi = Math.min(n - 1, Math.floor(n * 0.98));
  const cx = (xs[lo] + xs[hi]) / 2;
  const cy = (ys[lo] + ys[hi]) / 2;
  const cz = (zs[lo] + zs[hi]) / 2;
  const rBound = Math.max(xs[hi] - xs[lo], ys[hi] - ys[lo], zs[hi] - zs[lo]) / 2 || 1;
  return { center: new gsplat.Vector3(cx, cy, cz), rBound };
}

export default function GsplatViewer({ scanId, embedded = false }) {
  const t = useT();
  const canvasRef = useRef(null);
  const cleanupRef = useRef(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  // Fullscreen overlay. `embedded` instances (the ones rendered *inside* the
  // overlay) never re-open it — matches the TurntableViewer pattern.
  const [fullscreen, setFullscreen] = useState(false);
  // While the inline instance has the overlay open, it must stop rendering:
  // otherwise two WebGL contexts run at once and the model "loads twice".
  const paused = !embedded && fullscreen;

  useEffect(() => {
    if (!fullscreen) return undefined;
    const onKey = (e) => { if (e.key === "Escape") setFullscreen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreen]);

  useEffect(() => {
    // Inline instance with the overlay open → don't run a renderer at all
    // (the prior run's cleanup below has already torn it down).
    if (paused) return undefined;

    let cancelled = false;
    let raf = 0;

    (async () => {
      try {
        const gsplat = await import("gsplat");
        if (cancelled || !canvasRef.current) return;

        const canvas = canvasRef.current;
        const renderer = new gsplat.WebGLRenderer(canvas);
        const scene = new gsplat.Scene();

        // Reuse the cached buffer when present (fullscreen open / re-open).
        // gsplat's PLYLoader.LoadAsync fetches from inside its own web worker,
        // whose request doesn't carry our session cookie (→ 403 on private
        // scans) and can be served a stale SW error — so we fetch on the main
        // thread (authenticated, no-store) and hand the buffer to the parser.
        let buf = PLY_CACHE.get(scanId);
        if (!buf) {
          const res = await fetch(`/api/scans/${scanId}/splat`, {
            credentials: "include",
            cache: "no-store",
          });
          if (!res.ok) {
            throw new Error(`${res.status} ${res.statusText}`.trim());
          }
          buf = await res.arrayBuffer();
          if (cancelled || !canvasRef.current) {
            renderer.dispose?.();
            return;
          }
          cachePly(scanId, buf);
        }
        // Hand the loader a COPY so the cached buffer isn't detached/consumed.
        gsplat.PLYLoader.LoadFromArrayBuffer(buf.slice(0), scene);

        // Frame the figure. gsplat's camera has a FIXED focal length (fy≈1132),
        // so its vertical FOV is 2·atan(h / (2·fy)) — on a small canvas it's very
        // "telephoto", which is why a naive radius looked extremely zoomed-in.
        // Derive the orbit distance from the figure's half-extent and that real
        // FOV: distance = rBound·(2·fy / h)·margin, margin>1 leaving breathing
        // room (the figure fills ~1/margin of the view height).
        const { center, rBound } = frameSplat(scene, gsplat);
        const camera = new gsplat.Camera();
        const fy = camera.data?.fy || 1132;
        const h = canvas.clientHeight || canvas.clientWidth || 512;
        const radius = Math.max((rBound * 2 * fy / h) * 1.4, 0.02);
        // Keep the splat inside the frustum and let the user zoom past gsplat's
        // fixed caps (near/far 0.1–100, maxZoom 30) whatever the COLMAP scale.
        if (camera.data) {
          camera.data.near = Math.max(0.01, radius * 0.002);
          camera.data.far = Math.max(100, radius * 20);
        }
        const controls = new gsplat.OrbitControls(
          camera, canvas, undefined, undefined, radius, false, center,
        );
        controls.maxZoom = Math.max(controls.maxZoom, radius * 4);
        controls.minZoom = Math.min(controls.minZoom, radius * 0.05);

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
          controls.dispose?.();
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
  }, [scanId, paused]);

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
      {/* Inline slot: a paused placeholder while the overlay is open so the
          model isn't held by two live WebGL contexts at once. */}
      {paused ? (
        <div className="relative aspect-square w-full bg-[var(--color-noir)] border border-[var(--color-or)]/20 grid place-items-center">
          <p className="micro text-[var(--color-ivoire-soft)]">
            ⛶ {t("scan.viewer.paused")}
          </p>
        </div>
      ) : (
        stage
      )}
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

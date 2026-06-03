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

// Compute where to point the orbit camera. A gsplat `.ply` from COLMAP sits in
// COLMAP's arbitrary frame — NOT centred on the origin — so the default controls
// orbit empty space beside the figure ("the camera rotates in place"). We derive
// a robust centre (per-axis median, so stray floaters don't drag it) and a
// distance from a percentile radius (ignores the few far-flung floaters), then
// seed OrbitControls with them.
function frameSplat(scene, gsplat) {
  const fallback = { center: new gsplat.Vector3(0, 0, 0), radius: 5 };
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
  const mid = n >> 1;
  const cx = xs[mid];
  const cy = ys[mid];
  const cz = zs[mid];
  const d = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const dx = pos[3 * i] - cx;
    const dy = pos[3 * i + 1] - cy;
    const dz = pos[3 * i + 2] - cz;
    d[i] = Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
  d.sort();
  const r = d[Math.min(n - 1, Math.floor(n * 0.9))] || 1; // 90th-pct radius
  return { center: new gsplat.Vector3(cx, cy, cz), radius: Math.max(r * 2.3, 0.1) };
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

        // Orbit the figure's centre at a sensible distance (not the origin) —
        // otherwise the camera spins beside the off-origin splat. See frameSplat.
        const { center, radius } = frameSplat(scene, gsplat);
        const camera = new gsplat.Camera();
        const controls = new gsplat.OrbitControls(
          camera, canvas, undefined, undefined, radius, false, center,
        );

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

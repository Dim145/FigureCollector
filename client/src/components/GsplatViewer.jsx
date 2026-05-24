import { useEffect, useRef, useState } from "react";
import { useT } from "../i18n/index.jsx";

/**
 * Real 3D viewer for Gaussian Splatting `.ply` results (Phase 5B).
 *
 * Uses the `gsplat` npm package (purpose-built WebGL renderer for 3DGS, no
 * three.js peer dependency). Dynamic-imported so the chunk only ships when
 * a user actually opens a gsplat scan.
 */
export default function GsplatViewer({ scanId }) {
  const t = useT();
  const canvasRef = useRef(null);
  const cleanupRef = useRef(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

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

        await gsplat.PLYLoader.LoadAsync(
          `/api/scans/${scanId}/splat`,
          scene,
        );
        if (cancelled) {
          renderer.dispose?.();
          return;
        }

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

  return (
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
    </div>
  );
}

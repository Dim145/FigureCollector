import { useEffect, useMemo, useRef, useState } from "react";

/**
 * Drag-to-rotate viewer for a 360° turntable scan.
 *
 * Frames flow in two phases:
 *   1. boot — we kick off `Image()` preloads for every frame and count
 *      onload's. The visible <img> tags don't mount yet (so the viewport
 *      stays on a holding state rather than flashing half-decoded frames).
 *   2. ready — once every frame has either loaded or errored, we mount the
 *      <img> stack and start the auto-spin.
 *
 * This kills the "first-load flicker" where auto-spin would step into a
 * still-fetching frame and blank the viewer for a tick.
 */
export default function TurntableViewer({ scanId, frameCount }) {
  const containerRef = useRef(null);
  const [current, setCurrent] = useState(0);
  const drag = useRef(null);

  // -- Preload phase --------------------------------------------------------
  const urls = useMemo(
    () =>
      Array.from({ length: frameCount }, (_, i) => `/api/scans/${scanId}/frames/${i}`),
    [scanId, frameCount],
  );
  const [loaded, setLoaded] = useState(0);

  useEffect(() => {
    if (frameCount === 0) return;
    setLoaded(0);
    let cancelled = false;
    const imgs = urls.map((src) => {
      const im = new Image();
      // Force decode in browsers that support it so the GPU upload is done
      // before we ever paint. Best-effort: fall back to onload if decode()
      // is missing or rejects (some old WebP edge cases).
      const done = () => {
        if (cancelled) return;
        setLoaded((n) => n + 1);
      };
      im.onload = () => {
        if (cancelled) return;
        if (typeof im.decode === "function") im.decode().finally(done);
        else done();
      };
      im.onerror = done;
      im.src = src;
      return im;
    });
    return () => {
      cancelled = true;
      // Help the GC release the decoded pixels if the user nav'd away
      // before completion.
      imgs.forEach((im) => {
        im.onload = null;
        im.onerror = null;
        im.src = "";
      });
    };
  }, [urls, frameCount]);

  const ready = frameCount > 0 && loaded >= frameCount;

  // -- Auto-spin (only when ready) -----------------------------------------
  const [autoSpin, setAutoSpin] = useState(true);
  useEffect(() => {
    if (!autoSpin || !ready) return;
    const id = setInterval(() => {
      setCurrent((c) => (c + 1) % frameCount);
    }, 80);
    return () => clearInterval(id);
  }, [autoSpin, ready, frameCount]);

  // -- Pointer drag ---------------------------------------------------------
  const onPointerDown = (e) => {
    if (!ready) return;
    setAutoSpin(false);
    drag.current = { startX: e.clientX, startFrame: current };
    containerRef.current?.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e) => {
    if (!drag.current || !containerRef.current) return;
    const width = containerRef.current.clientWidth;
    const delta = e.clientX - drag.current.startX;
    const sensitivity = frameCount / Math.max(200, width * 0.8);
    const next = Math.round(drag.current.startFrame - delta * sensitivity);
    const wrapped = ((next % frameCount) + frameCount) % frameCount;
    setCurrent(wrapped);
  };
  const onPointerUp = (e) => {
    drag.current = null;
    containerRef.current?.releasePointerCapture(e.pointerId);
  };

  const pct = frameCount > 0 ? Math.round((loaded / frameCount) * 100) : 0;

  return (
    <div
      ref={containerRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={() => setAutoSpin((x) => !x)}
      className={`relative bg-[var(--color-noir)] border border-[var(--color-or)]/20 select-none touch-none aspect-square ${
        ready ? "cursor-grab active:cursor-grabbing" : "cursor-progress"
      }`}
      role="img"
      aria-label="360° turntable viewer"
    >
      {ready
        ? // All frames mounted, visibility toggled — preserves decoded state
          urls.map((src, i) => (
            <img
              key={i}
              src={src}
              alt=""
              draggable={false}
              loading="eager"
              className="absolute inset-0 w-full h-full object-contain pointer-events-none"
              style={{ visibility: i === current ? "visible" : "hidden" }}
            />
          ))
        : (
          // Holding state — gold ring + percentage so the viewer never paints
          // a half-decoded frame.
          <div className="absolute inset-0 grid place-items-center pointer-events-none">
            <div className="text-center">
              <div
                aria-hidden
                className="relative mx-auto w-16 h-16 rounded-full border border-[var(--color-or)]/20"
              >
                <div
                  className="absolute inset-0 rounded-full border border-transparent border-t-[var(--color-or)]"
                  style={{ animation: "spin 1.2s linear infinite" }}
                />
              </div>
              <p className="micro mt-4 font-mono">
                {loaded}/{frameCount}
              </p>
              <p className="text-[10px] uppercase tracking-[0.22em] text-[var(--color-ivoire-soft)] mt-1">
                {pct}%
              </p>
            </div>
          </div>
        )}

      {/* Progress ring at the bottom */}
      <div className="absolute bottom-3 left-3 right-3 pointer-events-none">
        <div className="h-px bg-[var(--color-or)]/15">
          <div
            className="h-px bg-[var(--color-or)] transition-[width] duration-75"
            style={{
              width: ready
                ? `${((current + 1) / frameCount) * 100}%`
                : `${pct}%`,
            }}
          />
        </div>
        <div className="mt-1.5 flex justify-between text-[10px] font-mono tracking-wider text-[var(--color-or-pale)] opacity-80">
          <span>
            {ready ? `${current + 1}/${frameCount}` : `${loaded}/${frameCount}`}
          </span>
          <span>{ready ? (autoSpin ? "↻ auto" : "✋ drag") : "⌛ load"}</span>
        </div>
      </div>
    </div>
  );
}

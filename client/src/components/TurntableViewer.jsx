import { useEffect, useRef, useState } from "react";

/**
 * Drag-to-rotate viewer for a 360° turntable scan.
 *
 * Implementation note: all frames are preloaded as <img> elements so the
 * GPU has them decoded. Switching frames is a single visibility toggle —
 * no flicker, no re-decode.
 */
export default function TurntableViewer({ scanId, frameCount }) {
  const containerRef = useRef(null);
  const [current, setCurrent] = useState(0);
  const drag = useRef(null);

  // Auto-spin when not interacting (gentle showcase).
  const [autoSpin, setAutoSpin] = useState(true);
  useEffect(() => {
    if (!autoSpin || frameCount === 0) return;
    const id = setInterval(() => {
      setCurrent((c) => (c + 1) % frameCount);
    }, 80);
    return () => clearInterval(id);
  }, [autoSpin, frameCount]);

  const onPointerDown = (e) => {
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

  return (
    <div
      ref={containerRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={() => setAutoSpin((x) => !x)}
      className="relative bg-[var(--color-noir)] border border-[var(--color-or)]/20 cursor-grab active:cursor-grabbing select-none touch-none aspect-square"
      role="img"
      aria-label="360° turntable viewer"
    >
      {/* All frames mounted, visibility toggled — preserves decoded state */}
      {Array.from({ length: frameCount }, (_, i) => (
        <img
          key={i}
          src={`/api/scans/${scanId}/frames/${i}`}
          alt=""
          draggable={false}
          loading="eager"
          className="absolute inset-0 w-full h-full object-contain pointer-events-none"
          style={{ visibility: i === current ? "visible" : "hidden" }}
        />
      ))}

      {/* Progress ring at the bottom */}
      <div className="absolute bottom-3 left-3 right-3 pointer-events-none">
        <div className="h-px bg-[var(--color-or)]/15">
          <div
            className="h-px bg-[var(--color-or)] transition-[width] duration-75"
            style={{ width: `${((current + 1) / frameCount) * 100}%` }}
          />
        </div>
        <div className="mt-1.5 flex justify-between text-[10px] font-mono tracking-wider text-[var(--color-or-pale)] opacity-80">
          <span>{current + 1}/{frameCount}</span>
          <span>{autoSpin ? "↻ auto" : "✋ drag"}</span>
        </div>
      </div>
    </div>
  );
}

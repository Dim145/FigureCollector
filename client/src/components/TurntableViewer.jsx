import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "../i18n/index.jsx";

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const WHEEL_ZOOM_STEP = 1.15;
// Pixels of accumulated wheel deltaY per single rotation step. Tuned so a
// mouse-wheel click (~120) jumps a few frames and a trackpad scroll feels
// smooth instead of either firing 50 frames at once or doing nothing.
const WHEEL_ROTATE_THRESHOLD = 25;

/**
 * Drag-to-rotate viewer for a 360° turntable scan.
 *
 * Frames flow in three phases:
 *   1. boot — a bounded-concurrency pool preloads every frame (with
 *      per-frame retry + backoff). The visible <img> tags don't mount
 *      yet so the viewport stays on a holding state.
 *   2. ready — once every frame loaded, we mount the <img> stack and
 *      start the auto-spin.
 *   3. error — if any frame permanently failed after its retries (e.g. a
 *      persistent 429), we show an explicit error + manual retry rather
 *      than silently spinning past a blank frame.
 *
 * Interactions:
 *   - Drag             rotate at fit, pan once zoomed
 *   - Wheel            rotate (deltaY accumulates → frame advance)
 *   - Ctrl/⌘ + wheel   zoom around the cursor
 *   - Pinch (2 doigts) zoom around the midpoint
 *   - Double-click     toggle auto-spin
 *   - "0"              reset zoom to fit
 */
export default function TurntableViewer({ scanId, frameCount, embedded = false }) {
  const t = useT();
  const containerRef = useRef(null);
  const [current, setCurrent] = useState(0);
  const drag = useRef(null);
  // Fullscreen overlay. `embedded` instances (the ones rendered *inside*
  // the overlay) never re-open it — that's what stops the recursion.
  const [fullscreen, setFullscreen] = useState(false);

  // -- Zoom + pan ----------------------------------------------------------
  // Same UX model as the Lightbox's useImageZoom, inlined because here the
  // drag axis is rotation (not pan) when at fit, so the hook isn't a direct
  // drop-in. `dragging` is a state (not a ref) so the inline transform's
  // transition can be disabled during a gesture for a 1:1 feel.
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const wheelAccum = useRef(0);
  const gestureRef = useRef({ mode: null });
  const isZoomed = zoom > MIN_ZOOM + 0.001;

  // -- Preload phase --------------------------------------------------------
  const urls = useMemo(
    () =>
      Array.from({ length: frameCount }, (_, i) => `/api/scans/${scanId}/frames/${i}`),
    [scanId, frameCount],
  );
  const [loaded, setLoaded] = useState(0);
  const [failed, setFailed] = useState(0);
  // Bumped by the manual "retry" button to re-run the preload effect from
  // scratch — the user's "retente à la prochaine tentative".
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    if (frameCount === 0) return undefined;
    setLoaded(0);
    setFailed(0);
    let cancelled = false;

    // Two root-cause fixes for the 429s we used to swallow:
    //  1. Bounded concurrency — firing all ~96 frame requests in one tick
    //     trips upstream rate limiters (reverse proxy / host). A small
    //     pool keeps the request rate civil.
    //  2. Retry with backoff — a transient 429 / network blip on a single
    //     frame is retried a few times (cache-busted so a cached 429 isn't
    //     replayed) instead of being silently counted as "loaded" and
    //     leaving a blank frame in the spin.
    const CONCURRENCY = 6;
    const MAX_RETRIES = 3;

    // Resolve true on success, false on permanent failure.
    const loadOne = (src) =>
      new Promise((resolve) => {
        let attempt = 0;
        const tryLoad = () => {
          if (cancelled) {
            resolve(false);
            return;
          }
          const im = new Image();
          const cleanup = () => {
            im.onload = null;
            im.onerror = null;
          };
          im.onload = () => {
            cleanup();
            if (cancelled) {
              resolve(false);
              return;
            }
            // Decode up-front so we never paint a half-decoded frame.
            if (typeof im.decode === "function") {
              im.decode().then(() => resolve(true), () => resolve(true));
            } else {
              resolve(true);
            }
          };
          im.onerror = () => {
            cleanup();
            if (cancelled) {
              resolve(false);
              return;
            }
            attempt += 1;
            if (attempt > MAX_RETRIES) {
              resolve(false);
              return;
            }
            // 400ms → 800ms → 1600ms + jitter.
            const delay = 400 * 2 ** (attempt - 1) + Math.random() * 200;
            setTimeout(tryLoad, delay);
          };
          // Cache-bust on retry so a browser-cached 429/error response
          // doesn't get replayed straight back to us.
          im.src = attempt === 0 ? src : `${src}?retry=${attempt}`;
        };
        tryLoad();
      });

    // Bounded-concurrency pool over the frame URLs.
    let cursor = 0;
    const worker = async () => {
      while (!cancelled && cursor < urls.length) {
        const ok = await loadOne(urls[cursor++]);
        if (cancelled) return;
        if (ok) setLoaded((n) => n + 1);
        else setFailed((n) => n + 1);
      }
    };
    const pool = Array.from(
      { length: Math.min(CONCURRENCY, urls.length) },
      () => worker(),
    );
    Promise.all(pool);

    return () => {
      cancelled = true;
    };
  }, [urls, frameCount, retryNonce]);

  // Reset zoom whenever the scan changes — each new scan opens at fit.
  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    wheelAccum.current = 0;
  }, [scanId]);

  const ready = frameCount > 0 && loaded >= frameCount;
  // Every frame has settled (loaded or permanently failed) and at least
  // one failed — surface the error instead of spinning forever or
  // mounting a viewer with holes in the rotation.
  const settled = frameCount > 0 && loaded + failed >= frameCount;
  const hasError = settled && failed > 0;

  // -- Auto-spin (only when ready AND at fit) -----------------------------
  // Pausing while zoomed avoids the "spinning under a magnifier" effect;
  // if the user zooms back out, the spin picks up where it left off.
  const [autoSpin, setAutoSpin] = useState(true);
  useEffect(() => {
    if (!autoSpin || !ready || isZoomed) return;
    const id = setInterval(() => {
      setCurrent((c) => (c + 1) % frameCount);
    }, 80);
    return () => clearInterval(id);
  }, [autoSpin, ready, frameCount, isZoomed]);

  // -- Fullscreen: close on Esc --------------------------------------------
  useEffect(() => {
    if (!fullscreen) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") setFullscreen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreen]);

  // -- Reset zoom with "0" -------------------------------------------------
  useEffect(() => {
    if (!isZoomed) return undefined;
    const onKey = (e) => {
      if (e.target?.tagName === "INPUT" || e.target?.tagName === "TEXTAREA") return;
      if (e.key === "0") {
        e.preventDefault();
        setZoom(1);
        setPan({ x: 0, y: 0 });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isZoomed]);

  // -- Clamp pan so the figure can't be dragged off the viewport ---------
  // `z` is the next zoom level the caller is about to apply; we measure the
  // fit rect from the current zoom snapshot (rect.width / zoom).
  const clampPan = useCallback(
    (p, z) => {
      const el = containerRef.current;
      if (!el) return p;
      const rect = el.getBoundingClientRect();
      const fitW = rect.width / Math.max(zoom, MIN_ZOOM);
      const fitH = rect.height / Math.max(zoom, MIN_ZOOM);
      const maxX = (fitW * (z - 1)) / 2;
      const maxY = (fitH * (z - 1)) / 2;
      return {
        x: Math.max(-maxX, Math.min(maxX, p.x)),
        y: Math.max(-maxY, Math.min(maxY, p.y)),
      };
    },
    [zoom],
  );

  // -- Wheel: Ctrl/⌘ → zoom at cursor; otherwise → rotate. --------------
  // Native non-passive listener — React's onWheel is wired to a passive
  // root listener so `preventDefault()` silently no-ops there, letting the
  // page scroll underneath instead of letting us consume the gesture.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !ready) return undefined;
    const handler = (e) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        // Focal-point-preserving zoom: the pixel under the cursor stays
        // fixed as the image scales. Same math as useImageZoom.
        const factor = e.deltaY < 0 ? WHEEL_ZOOM_STEP : 1 / WHEEL_ZOOM_STEP;
        const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom * factor));
        if (Math.abs(next - zoom) < 0.001) return;
        const rect = el.getBoundingClientRect();
        const cx = e.clientX - (rect.left + rect.width / 2);
        const cy = e.clientY - (rect.top + rect.height / 2);
        const ratio = next / zoom;
        const nextPan = {
          x: cx - ratio * (cx - pan.x),
          y: cy - ratio * (cy - pan.y),
        };
        setZoom(next);
        setPan(next <= MIN_ZOOM + 0.001 ? { x: 0, y: 0 } : clampPan(nextPan, next));
      } else {
        // Accumulate scroll so trackpad small ticks and mouse-wheel clicks
        // both feel right — one rotation step per ~25px of cumulative scroll.
        // Take whichever axis dominates so a horizontal two-finger swipe on a
        // trackpad rotates just as naturally as a vertical mouse-wheel scroll.
        setAutoSpin(false);
        const axis =
          Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
        wheelAccum.current += axis;
        const steps = Math.trunc(wheelAccum.current / WHEEL_ROTATE_THRESHOLD);
        if (steps !== 0) {
          wheelAccum.current -= steps * WHEEL_ROTATE_THRESHOLD;
          // Subtract steps so the direction matches the drag handler — a
          // right-swipe/scroll-down rotates the figure the same way as
          // dragging right (which uses `startFrame - delta * sensitivity`).
          setCurrent((c) => (((c - steps) % frameCount) + frameCount) % frameCount);
        }
      }
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, [ready, zoom, pan, frameCount, clampPan]);

  // -- Touch: pinch (2 fingers) + post-pinch single-finger pan ------------
  // Attached natively for the same reason as the wheel — synthetic touch
  // events go through a passive root listener that can't preventDefault,
  // and we need that to suppress iOS rubber-band / pinch-zoom of the page.
  //
  // `touch-action: none` on the container already stops the browser
  // claiming the gesture; this supplies the JS half.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !ready) return undefined;
    const g = gestureRef.current;

    const distOf = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    const midOf = (a, b) => ({
      x: (a.clientX + b.clientX) / 2,
      y: (a.clientY + b.clientY) / 2,
    });
    // Snapshot the fit size + the untransformed (layout) centre so all
    // pinch math runs in fixed coords (screen = pan + zoom·natural,
    // measured from the layout centre).
    const snapshot = (z0, p0) => {
      const rect = el.getBoundingClientRect();
      g.fitW = rect.width / Math.max(z0, MIN_ZOOM);
      g.fitH = rect.height / Math.max(z0, MIN_ZOOM);
      g.cx = rect.left + rect.width / 2 - p0.x;
      g.cy = rect.top + rect.height / 2 - p0.y;
    };
    const clamp = (p, z) => {
      const maxX = (g.fitW * (z - 1)) / 2;
      const maxY = (g.fitH * (z - 1)) / 2;
      return {
        x: Math.max(-maxX, Math.min(maxX, p.x)),
        y: Math.max(-maxY, Math.min(maxY, p.y)),
      };
    };

    const onStart = (e) => {
      if (e.touches.length >= 2) {
        // A second finger pre-empts any in-flight pointer drag — the
        // pinch wins over rotate/pan.
        if (drag.current) {
          try { el.releasePointerCapture(drag.current.pointerId); } catch { /* noop */ }
          drag.current = null;
        }
        snapshot(zoom, pan);
        const m = midOf(e.touches[0], e.touches[1]);
        const focal = { x: m.x - g.cx, y: m.y - g.cy };
        g.mode = "pinch";
        g.startDist = distOf(e.touches[0], e.touches[1]) || 1;
        g.startZoom = zoom;
        // Natural point under the pinch midpoint — kept under the fingers
        // as they spread/move:  i = (focal − pan) / zoom.
        g.i0 = { x: (focal.x - pan.x) / zoom, y: (focal.y - pan.y) / zoom };
        setDragging(true);
      }
    };

    const onMove = (e) => {
      if (g.mode === "pinch" && e.touches.length >= 2) {
        e.preventDefault();
        const d = distOf(e.touches[0], e.touches[1]);
        const m = midOf(e.touches[0], e.touches[1]);
        const next = Math.min(
          MAX_ZOOM,
          Math.max(MIN_ZOOM, g.startZoom * (d / g.startDist)),
        );
        const focal = { x: m.x - g.cx, y: m.y - g.cy };
        const nextPan = { x: focal.x - next * g.i0.x, y: focal.y - next * g.i0.y };
        setZoom(next);
        setPan(next <= MIN_ZOOM + 0.001 ? { x: 0, y: 0 } : clamp(nextPan, next));
      } else if (g.mode === "pan" && e.touches.length === 1) {
        e.preventDefault();
        const tch = e.touches[0];
        setPan(
          clamp(
            {
              x: g.startPan.x + (tch.clientX - g.startTouch.x),
              y: g.startPan.y + (tch.clientY - g.startTouch.y),
            },
            g.panZoom,
          ),
        );
      }
    };

    const onEnd = (e) => {
      if (e.touches.length === 0) {
        g.mode = null;
        setDragging(false);
      } else if (e.touches.length === 1 && zoom > MIN_ZOOM) {
        // 2→1: keep panning with the surviving finger, re-anchored so the
        // image doesn't jump (mirrors useImageZoom).
        snapshot(zoom, pan);
        g.mode = "pan";
        g.panZoom = zoom;
        g.startPan = pan;
        g.startTouch = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      } else {
        g.mode = null;
        setDragging(false);
      }
    };

    el.addEventListener("touchstart", onStart, { passive: false });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd, { passive: false });
    el.addEventListener("touchcancel", onEnd, { passive: false });
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
  }, [ready, zoom, pan]);

  // -- Pointer drag: rotate at fit, pan once zoomed. ----------------------
  const onPointerDown = (e) => {
    if (!ready) return;
    // Ignore secondary pointers (a second touch fires pointerdown too —
    // the pinch handler will own the gesture).
    if (drag.current || gestureRef.current.mode) return;
    setAutoSpin(false);
    setDragging(true);
    if (isZoomed) {
      drag.current = {
        mode: "pan",
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        startPan: pan,
      };
    } else {
      drag.current = {
        mode: "rotate",
        pointerId: e.pointerId,
        startX: e.clientX,
        startFrame: current,
      };
    }
    containerRef.current?.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId || !containerRef.current) return;
    if (d.mode === "pan") {
      const dx = e.clientX - d.startX;
      const dy = e.clientY - d.startY;
      setPan(clampPan({ x: d.startPan.x + dx, y: d.startPan.y + dy }, zoom));
    } else {
      const width = containerRef.current.clientWidth;
      const delta = e.clientX - d.startX;
      const sensitivity = frameCount / Math.max(200, width * 0.8);
      const next = Math.round(d.startFrame - delta * sensitivity);
      const wrapped = ((next % frameCount) + frameCount) % frameCount;
      setCurrent(wrapped);
    }
  };
  const onPointerUp = (e) => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    setDragging(false);
    try { containerRef.current?.releasePointerCapture(d.pointerId); } catch { /* noop */ }
  };

  const pct = frameCount > 0 ? Math.round((loaded / frameCount) * 100) : 0;

  const stage = (
    <div
      ref={containerRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={() => setAutoSpin((x) => !x)}
      className={`relative bg-[var(--color-noir)] border border-[var(--color-or)]/20 select-none touch-none ${
        embedded ? "w-full h-full" : "aspect-square"
      } ${ready ? "cursor-grab active:cursor-grabbing" : "cursor-progress"}`}
      role="img"
      aria-label="360° turntable viewer"
    >
      {ready ? (
        // Zoom + pan layer — the frames stack lives INSIDE this transformed
        // div so rotation (visibility-switching) and zoom (CSS transform)
        // compose cleanly without touching each other's math.
        <div
          className="absolute inset-0 will-change-transform"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: "center",
            // Smooth zoom on wheel + click; instant during an active
            // gesture so the image tracks the fingers/cursor 1:1.
            transition: dragging
              ? "none"
              : "transform 280ms cubic-bezier(0.22, 1, 0.36, 1)",
          }}
        >
          {urls.map((src, i) => (
            <img
              key={i}
              src={src}
              alt=""
              draggable={false}
              loading="eager"
              className="absolute inset-0 w-full h-full object-contain pointer-events-none"
              style={{ visibility: i === current ? "visible" : "hidden" }}
            />
          ))}
        </div>
      ) : hasError ? (
        // Error state — some frames never loaded (persistent 429 / network).
        // Surface it + offer a manual retry instead of hiding the failure.
        <div className="absolute inset-0 grid place-items-center p-6 text-center">
          <div>
            <p className="ja text-[var(--color-laque-bright)] text-3xl leading-none" aria-hidden>
              ✕
            </p>
            <p
              role="alert"
              className="mt-3 text-sm text-[var(--color-ivoire-soft)] max-w-[28ch]"
            >
              {t("turntable.viewer.load_error", { failed, total: frameCount })}
            </p>
            <button
              type="button"
              onClick={() => setRetryNonce((n) => n + 1)}
              className="mt-4 text-[10px] uppercase tracking-[0.22em] text-[var(--color-or)] hover:text-[var(--color-or-pale)] border border-[var(--color-or)]/40 hover:border-[var(--color-or)] px-3 py-1.5 transition-colors"
            >
              ↻ {t("turntable.viewer.retry")}
            </button>
          </div>
        </div>
      ) : (
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
          <span>
            {ready
              ? isZoomed
                ? "↔ pan"
                : autoSpin
                  ? "↻ auto"
                  : "✋ drag"
              : "⌛ load"}
          </span>
        </div>
      </div>

      {/* Zoom indicator — appears only when actively zoomed. Mirrors the
       *  Lightbox badge (拡 + percentage + "0 = fit" hint) so the two
       *  viewers feel consistent. */}
      {isZoomed ? (
        <div
          aria-hidden
          className="absolute top-2 left-2 z-10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-or-pale)] bg-[var(--color-noir)]/80 border border-[var(--color-or)]/40 flex items-center gap-2 pointer-events-none"
        >
          <span className="ja text-[var(--color-or)] not-italic" aria-hidden>
            拡
          </span>
          <span>{Math.round(zoom * 100)}%</span>
          <span className="opacity-50">·</span>
          <span className="opacity-60">0 = fit</span>
        </div>
      ) : null}

      {/* Fullscreen toggle — only on the inline instance (not the one
          already rendered inside the overlay), and only once frames are
          ready so it doesn't overlap the loading ring. */}
      {!embedded && ready ? (
        <button
          type="button"
          onClick={() => setFullscreen(true)}
          // Stop pointer events from bubbling to the container — its
          // onPointerDown calls setPointerCapture on the container, which
          // otherwise eats this button's click (no fullscreen on tap).
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
                // Big square capped to the smaller viewport side so it
                // stays fully visible on both portrait phones and wide
                // desktops, with the same gold frame as the hero.
                style={{ width: "min(88vmin, 960px)", height: "min(88vmin, 960px)" }}
              >
                <TurntableViewer
                  scanId={scanId}
                  frameCount={frameCount}
                  embedded
                />
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

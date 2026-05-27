import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Zoom + pan interactions for a single image inside a viewer.
 *
 * UX model (Lightroom / Apple Photos / Pinch.dev hybrid):
 *
 *   - Click on the image (no movement) → toggle zoom:
 *       * if currently at fit (z = 1): zoom in to ZOOM_CLICK, centered on
 *         the click point so the pixel you clicked stays under the cursor.
 *       * if already zoomed: reset to fit.
 *   - Mouse wheel / trackpad: fine-grained continuous zoom. The pixel
 *     under the cursor stays stable. Capped at MIN_ZOOM..MAX_ZOOM.
 *   - Pinch (two fingers): continuous zoom around the midpoint, which
 *     stays pinned under the fingers as they spread and slide. Capped at
 *     MIN_ZOOM..MAX_ZOOM; lifting one finger keeps panning from the other.
 *   - Drag (mouse / single-finger touch) while zoomed: pan the image.
 *     Pan is clamped so the image edges can't fly past the container
 *     center — the user can never lose the figure off-screen.
 *   - "0" key resets zoom + pan to fit.
 *   - Cursor reflects state: zoom-in → grab → grabbing.
 *
 * Returns:
 *   transformStyle  : { transform, transition, cursor, willChange }
 *   imgHandlers     : props to spread on the <img> (onMouseDown, onWheel,
 *                     onTouchStart, ...).
 *   reset()         : programmatic reset (called by Lightbox on slide change).
 *   isZoomed        : convenience boolean for chrome (e.g., "× 250 %" badge).
 *   zoomPercent     : integer 100..MAX_ZOOM*100 for display.
 *
 * Notes
 *   - Uses container-relative coordinates with origin at center so the
 *     math is symmetric and the clamps stay simple.
 *   - Drag uses window-level listeners so the gesture survives the
 *     pointer leaving the image rectangle.
 */

const MIN_ZOOM = 1;
const MAX_ZOOM = 5;
/** Zoom level the click-to-zoom shortcut snaps to from the fit state. */
const ZOOM_CLICK = 2.5;
const WHEEL_STEP = 1.15;
/** Pixels of movement before a mousedown is treated as a drag (not a click). */
const DRAG_THRESHOLD = 4;

export function useImageZoom() {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  /** The wrapper element (<img> or its container) the user interacts with. */
  const elRef = useRef(null);
  /** Mousedown state — used to distinguish click vs drag at mouseup. */
  const downRef = useRef(null);

  const reset = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  /**
   * Clamp pan so the image can't be dragged so far that its edge crosses
   * the container's center — that's the point at which the user would
   * "lose" the figure off-screen.
   */
  const clampPan = useCallback((p, z) => {
    const el = elRef.current;
    if (!el) return p;
    const rect = el.getBoundingClientRect();
    // `rect` is the rendered (= post-transform) bounding box. Convert to
    // the natural fit rect by dividing by current zoom… but for clamping
    // we care about the NEW zoom z. Use the fit size = rect / current
    // zoom snapshot. We deliberately don't read `zoom` from state here
    // because the caller hands us the next-zoom value.
    const fitW = rect.width / Math.max(zoom, MIN_ZOOM);
    const fitH = rect.height / Math.max(zoom, MIN_ZOOM);
    const maxX = (fitW * (z - 1)) / 2;
    const maxY = (fitH * (z - 1)) / 2;
    return {
      x: Math.max(-maxX, Math.min(maxX, p.x)),
      y: Math.max(-maxY, Math.min(maxY, p.y)),
    };
  }, [zoom]);

  /** Translate a client (page) coordinate into container-center-relative coords. */
  const toCenterCoords = useCallback((clientX, clientY) => {
    const el = elRef.current;
    if (!el) return { x: 0, y: 0 };
    const rect = el.getBoundingClientRect();
    return {
      x: clientX - (rect.left + rect.width / 2),
      y: clientY - (rect.top + rect.height / 2),
    };
  }, []);

  // ─── Mousedown: kick off a potential drag, attach window listeners. ──
  // We attach the window-level move/up listeners imperatively here (rather
  // than via a useEffect that watches `downRef.current`) because refs don't
  // trigger re-renders — so a useEffect can't react to "downRef changed".
  // The listeners live until mouseup, then unsubscribe themselves.
  const onMouseDown = useCallback(
    (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const startPan = pan;
      const startZoom = zoom;
      downRef.current = {
        x: e.clientX,
        y: e.clientY,
        startPan,
        moved: false,
      };
      if (startZoom > 1) setDragging(true);

      const onMove = (ev) => {
        const down = downRef.current;
        if (!down) return;
        const dx = ev.clientX - down.x;
        const dy = ev.clientY - down.y;
        if (!down.moved && Math.hypot(dx, dy) > DRAG_THRESHOLD) {
          down.moved = true;
        }
        if (down.moved && startZoom > 1) {
          setPan(
            clampPan(
              {
                x: down.startPan.x + dx,
                y: down.startPan.y + dy,
              },
              startZoom,
            ),
          );
        }
      };
      const onUp = (ev) => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        const down = downRef.current;
        downRef.current = null;
        setDragging(false);
        if (!down) return;
        // No-move release: treat as click → toggle zoom at the press point.
        if (!down.moved) {
          const center = toCenterCoords(ev.clientX, ev.clientY);
          if (startZoom <= MIN_ZOOM + 0.001) {
            const next = ZOOM_CLICK;
            setZoom(next);
            setPan(clampPan({ x: -center.x * (next - 1), y: -center.y * (next - 1) }, next));
          } else {
            reset();
          }
        }
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [pan, zoom, clampPan, toCenterCoords, reset],
  );

  // ─── Wheel: zoom around the cursor. ─────────────────────────────────
  //
  // React 17+ attaches `onWheel` as a PASSIVE listener at the document root,
  // which silently no-ops `e.preventDefault()` — so the browser scrolls the
  // page underneath instead of letting us consume the gesture. Attach
  // natively on the image ref with `{ passive: false }` to actually own
  // the gesture. The effect re-binds when zoom/pan change so the handler
  // always closes over the latest values.
  useEffect(() => {
    const el = elRef.current;
    if (!el) return undefined;
    const handler = (e) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? WHEEL_STEP : 1 / WHEEL_STEP;
      const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom * factor));
      if (Math.abs(next - zoom) < 0.001) return;
      const cursor = toCenterCoords(e.clientX, e.clientY);
      // Keep the image point under the cursor fixed:
      //   c = p + z * i   →   i = (c - p) / z
      //   p' = c - z' * i = c - (z'/z) * (c - p)
      const ratio = next / zoom;
      const nextPan = {
        x: cursor.x - ratio * (cursor.x - pan.x),
        y: cursor.y - ratio * (cursor.y - pan.y),
      };
      setZoom(next);
      setPan(next <= MIN_ZOOM + 0.001 ? { x: 0, y: 0 } : clampPan(nextPan, next));
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, [zoom, pan, toCenterCoords, clampPan]);

  // ─── Touch: pinch-to-zoom (2 fingers) + drag-to-pan (1 finger). ──────
  //
  // Attached as NATIVE non-passive listeners (like the wheel handler) so
  // `preventDefault()` actually suppresses iOS page-zoom / rubber-band —
  // React routes synthetic touch events through a passive root listener
  // that silently no-ops preventDefault. `touch-action: none` on the
  // <img> already stops the browser claiming the gesture; this supplies
  // the JS half the disabled native pinch used to do.
  //
  // The effect re-binds whenever zoom/pan change (mirroring the wheel
  // handler — that's also what makes it (re)bind once the <img> mounts,
  // since opening the lightbox resets pan to a fresh object). Gesture
  // state lives in a ref so an in-flight pinch/pan survives the re-bind.
  //
  // We deliberately DON'T preventDefault on touchstart: that would cancel
  // the synthesized click that powers tap-to-zoom. Only touchmove (a real
  // gesture) consumes the event.
  const gestureRef = useRef({ mode: null });
  useEffect(() => {
    const el = elRef.current;
    if (!el) return undefined;
    const g = gestureRef.current;

    const distOf = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    const midOf = (a, b) => ({
      x: (a.clientX + b.clientX) / 2,
      y: (a.clientY + b.clientY) / 2,
    });
    const clamp = (p, z) => {
      const maxX = (g.fitW * (z - 1)) / 2;
      const maxY = (g.fitH * (z - 1)) / 2;
      return {
        x: Math.max(-maxX, Math.min(maxX, p.x)),
        y: Math.max(-maxY, Math.min(maxY, p.y)),
      };
    };
    // Snapshot the fit size + the untransformed (layout) centre from the
    // live post-transform rect, so all gesture math runs in fixed coords
    // (screen = pan + zoom·natural, measured from the layout centre).
    const snapshot = (z0, p0) => {
      const rect = el.getBoundingClientRect();
      g.fitW = rect.width / Math.max(z0, MIN_ZOOM);
      g.fitH = rect.height / Math.max(z0, MIN_ZOOM);
      g.cx = rect.left + rect.width / 2 - p0.x;
      g.cy = rect.top + rect.height / 2 - p0.y;
    };

    const onStart = (e) => {
      if (e.touches.length >= 2) {
        snapshot(zoom, pan);
        const m = midOf(e.touches[0], e.touches[1]);
        const focal = { x: m.x - g.cx, y: m.y - g.cy };
        g.mode = "pinch";
        g.startDist = distOf(e.touches[0], e.touches[1]) || 1;
        g.startZoom = zoom;
        // Natural point under the pinch midpoint — kept under the fingers
        // as they spread/move:  i = (focal − pan) / zoom.
        g.i0 = { x: (focal.x - pan.x) / zoom, y: (focal.y - pan.y) / zoom };
      } else if (e.touches.length === 1 && zoom > MIN_ZOOM) {
        snapshot(zoom, pan);
        g.mode = "pan";
        g.panZoom = zoom;
        g.startPan = pan;
        g.startTouch = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      } else {
        // Single tap at fit → let the synthesized click toggle the zoom.
        g.mode = null;
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
      } else if (e.touches.length === 1 && zoom > MIN_ZOOM) {
        // Lifted one finger out of a pinch — keep panning from the other,
        // re-anchored so the image doesn't jump.
        snapshot(zoom, pan);
        g.mode = "pan";
        g.panZoom = zoom;
        g.startPan = pan;
        g.startTouch = { x: e.touches[0].clientX, y: e.touches[0].clientY };
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
  }, [zoom, pan]);

  // ─── Keyboard shortcut: 0 resets. ───────────────────────────────────
  useEffect(() => {
    const onKey = (e) => {
      // Ignore when the user is typing in an input.
      if (
        e.target &&
        (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")
      ) {
        return;
      }
      if (e.key === "0") {
        e.preventDefault();
        reset();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [reset]);

  const isZoomed = zoom > MIN_ZOOM + 0.001;

  const transformStyle = {
    transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
    // Smooth transition for click-to-zoom; instant during drag/wheel for
    // direct gesture response. Wheel + drag both update state at native
    // event rates, so the "instant" path is what feels right.
    // Smooth transition for click-toggle + wheel. Disabled while a drag
    // is active so the panning gesture stays 1:1 with the cursor.
    transition: dragging ? "none" : "transform 280ms cubic-bezier(0.22, 1, 0.36, 1)",
    cursor: dragging
      ? "grabbing"
      : isZoomed
        ? "grab"
        : "zoom-in",
    willChange: "transform",
    // Disable native browser zoom on touch — we handle it.
    touchAction: "none",
    userSelect: "none",
  };

  // Bundle everything the consumer needs into one `imgProps` object so
  // callers do `<img {...zoom.imgProps} />` and the lint rule
  // `react-hooks/refs-in-render` doesn't see a free-standing `xxxRef`
  // property being read during render.
  // Note: the wheel + touch handlers are attached natively via the effects
  // above (React's synthetic onWheel/onTouch* go through a passive root
  // listener that can't preventDefault), so they're NOT in this bundle.
  // onMouseDown is fine as a synthetic event.
  const imgProps = {
    ref: elRef,
    onMouseDown,
    draggable: false,
    style: transformStyle,
  };

  return {
    imgProps,
    isZoomed,
    zoomPercent: Math.round(zoom * 100),
    reset,
  };
}

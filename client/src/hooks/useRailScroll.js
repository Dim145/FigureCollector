import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Shared behaviour for the app's ~15 horizontal rails (contextual sub-nav,
 * admin nav, tabs, condition tiles, catalogue search modes…).
 *
 * Two jobs, both lifted from the one rail that already did it right
 * (`pages/figure-detail/FigureAnchorIndex.jsx`):
 *
 *  1. **Centre the active item.** We compute `scrollLeft` from the item's
 *     offset inside the rail and scroll ONLY the rail. `scrollIntoView` would
 *     scroll every ancestor *vertically* too, which on mobile fights the page
 *     scroll and yanks the reader back up.
 *  2. **Say that it scrolls.** `edges` reports whether content is clipped left
 *     / right so the caller can fade that edge — a rail with a hidden
 *     scrollbar is otherwise indistinguishable from a rail that just ends.
 *
 * Honours `prefers-reduced-motion` (jumps instead of animating).
 *
 *   const { ref, edges } = useRailScroll(activeId);
 *   <div ref={ref} data-edge-start={edges.start} data-edge-end={edges.end}>
 *     <a data-rail-item={id} …>
 */
export default function useRailScroll(activeKey, { attr = "data-rail-item" } = {}) {
  const ref = useRef(null);
  const [edges, setEdges] = useState({ start: false, end: false });

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    // 1px tolerance: sub-pixel layouts otherwise report a permanent overflow.
    setEdges((prev) => {
      const next = { start: el.scrollLeft > 1, end: el.scrollLeft < max - 1 };
      return prev.start === next.start && prev.end === next.end ? prev : next;
    });
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    // Re-measure when the rail itself resizes (font load, filter chips added).
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    return () => {
      el.removeEventListener("scroll", measure);
      ro?.disconnect();
    };
  }, [measure]);

  useEffect(() => {
    const el = ref.current;
    if (!el || activeKey == null) return;
    // Match by attribute value rather than a CSS selector — keys can contain
    // quotes/spaces (tag names, condition labels) that would break a selector.
    let item = null;
    for (const node of el.querySelectorAll(`[${attr}]`)) {
      if (node.getAttribute(attr) === String(activeKey)) {
        item = node;
        break;
      }
    }
    if (!item) return;
    const target = item.offsetLeft - el.clientWidth / 2 + item.offsetWidth / 2;
    const max = el.scrollWidth - el.clientWidth;
    const left = Math.max(0, Math.min(target, max));
    // Don't fight the user over a couple of pixels.
    if (Math.abs(left - el.scrollLeft) < 4) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({ left, behavior: reduce ? "instant" : "smooth" });
  }, [activeKey, attr]);

  return { ref, edges, measure };
}

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

/**
 * Mount-on-scroll gate for below-the-fold almanac chapters.
 *
 * The old StatsPage rendered the whole 1483-line ledger eagerly (heavy first
 * paint, several Recharts donuts + dozens of nodes built up-front). This wraps
 * each chapter so its children only mount when the placeholder nears the
 * viewport — first paint becomes just the frontispiece + the first chapter.
 *
 * - IntersectionObserver with a generous `rootMargin` so a chapter is ready by
 *   the time it scrolls in (no pop-in).
 * - Once mounted it stays mounted (the observer disconnects) so scrolling back
 *   up never re-runs the chart build.
 * - Reserves `minHeight` while unmounted so the scrollbar + jump-nav anchors
 *   don't jump as chapters hydrate.
 * - No IO support (or the page is pre-rendered) → render eagerly.
 * - `RevealAll` escape hatch: the jump-nav forces every chapter to mount before
 *   scrolling to a below-the-fold anchor (the anchor lives inside the lazy
 *   children, so a TOC jump to a not-yet-mounted chapter would be a dead click).
 */
const RevealAllContext = createContext({ revealed: false, revealAll: () => {} });

/** Provider: once `revealAll()` fires, every LazyChapter below mounts at once. */
export function RevealAllProvider({ children }) {
  const [revealed, setRevealed] = useState(false);
  const revealAll = useCallback(() => setRevealed(true), []);
  const value = useMemo(() => ({ revealed, revealAll }), [revealed, revealAll]);
  return <RevealAllContext.Provider value={value}>{children}</RevealAllContext.Provider>;
}

/** Hook for the jump-nav to mount every chapter before scrolling. */
export function useRevealAll() {
  return useContext(RevealAllContext);
}

export default function LazyChapter({ minHeight = 360, rootMargin = "600px 0px", children }) {
  const { revealed } = useRevealAll();
  const supported =
    typeof window !== "undefined" && typeof window.IntersectionObserver === "function";
  const [shown, setShown] = useState(!supported);
  const ref = useRef(null);

  useEffect(() => {
    if (shown || revealed) return undefined;
    const el = ref.current;
    if (!el) return undefined;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setShown(true);
          io.disconnect();
        }
      },
      { rootMargin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [shown, revealed, rootMargin]);

  if (shown || revealed) return children;
  return <div ref={ref} aria-hidden style={{ minHeight }} />;
}

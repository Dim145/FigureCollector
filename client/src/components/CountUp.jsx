import { useEffect, useRef, useState } from "react";

/**
 * Counter that animates from 0 (or the previously-rendered value) up to
 * the target on first scroll-into-view. Designed for KPI displays where
 * the reveal *is* the moment.
 *
 * The easing is expo-out so the number lands softly. Honours
 * `prefers-reduced-motion` by snapping to the target instantly. Uses an
 * IntersectionObserver so off-screen counters don't burn frames.
 *
 * @param {number} value          The final number to display.
 * @param {number} [duration=1100]  Animation length in ms.
 * @param {string} [className]    Pass-through.
 * @param {(n:number) => string} [format]  Custom formatter. Default:
 *   locale-aware integer with grouping.
 */
export default function CountUp({
  value,
  duration = 1100,
  className = "",
  format,
}) {
  const ref = useRef(null);
  const [shown, setShown] = useState(0);
  // Track the last value we animated TO so subsequent updates can ease
  // from the current display to the new target. Previously a sticky
  // `startedRef.current = true` froze the counter on the initial value
  // even if `value` later changed (live-sync invalidation could bump the
  // owned-count while the displayed number stayed at the older target).
  const shownRef = useRef(0);
  const lastAnimatedRef = useRef(null);

  useEffect(() => {
    if (!Number.isFinite(value)) return;
    if (typeof window === "undefined") {
      setShown(value);
      shownRef.current = value;
      lastAnimatedRef.current = value;
      return;
    }
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setShown(value);
      shownRef.current = value;
      lastAnimatedRef.current = value;
      return;
    }

    const el = ref.current;
    if (!el) return;

    let cancelled = false;
    let cleanupRaf = null;

    const tick = (target, start) => {
      const startTs = performance.now();
      let raf;
      const step = (ts) => {
        if (cancelled) return;
        const t = Math.min(1, (ts - startTs) / duration);
        const eased = 1 - Math.pow(1 - t, 4); // expo-out
        const next = start + (target - start) * eased;
        const final = t === 1 ? target : next;
        setShown(final);
        shownRef.current = final;
        if (t < 1) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
      cleanupRaf = () => cancelAnimationFrame(raf);
    };

    // If we already animated once before, skip the IntersectionObserver
    // gate (the element is presumably still on-screen since the value
    // just changed) and ease directly from the current displayed number
    // to the new target.
    if (lastAnimatedRef.current !== null && lastAnimatedRef.current !== value) {
      lastAnimatedRef.current = value;
      tick(value, shownRef.current);
    } else {
      const io = new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            if (e.isIntersecting && lastAnimatedRef.current === null) {
              lastAnimatedRef.current = value;
              tick(value, 0);
              io.disconnect();
            }
          }
        },
        { threshold: 0.25 },
      );
      io.observe(el);
      return () => {
        io.disconnect();
        cancelled = true;
        cleanupRaf?.();
      };
    }
    return () => {
      cancelled = true;
      cleanupRaf?.();
    };
  }, [value, duration]);

  const fmt =
    format ?? ((n) => Math.round(n).toLocaleString());

  return (
    <span ref={ref} className={className} aria-label={String(value)}>
      {fmt(shown)}
    </span>
  );
}

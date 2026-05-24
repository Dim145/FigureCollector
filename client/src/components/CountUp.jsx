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
  const startedRef = useRef(false);

  useEffect(() => {
    if (!Number.isFinite(value)) return;
    if (typeof window === "undefined") {
      setShown(value);
      return;
    }
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setShown(value);
      return;
    }

    const el = ref.current;
    if (!el) return;

    const tick = (target, start) => {
      const startTs = performance.now();
      let raf;
      const step = (ts) => {
        const t = Math.min(1, (ts - startTs) / duration);
        const eased = 1 - Math.pow(1 - t, 4); // expo-out
        const next = start + (target - start) * eased;
        setShown(t === 1 ? target : next);
        if (t < 1) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
      return () => cancelAnimationFrame(raf);
    };

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting && !startedRef.current) {
            startedRef.current = true;
            tick(value, 0);
            io.disconnect();
          }
        }
      },
      { threshold: 0.25 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [value, duration]);

  const fmt =
    format ?? ((n) => Math.round(n).toLocaleString());

  return (
    <span ref={ref} className={className} aria-label={String(value)}>
      {fmt(shown)}
    </span>
  );
}

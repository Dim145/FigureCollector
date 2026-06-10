import { useEffect, useRef, useState } from "react";
import { appLocale } from "../lib/locale.js";

/**
 * Counter that animates from 0 (or the previously-rendered value) up to
 * the target on first scroll-into-view. Designed for KPI displays where
 * the reveal *is* the moment.
 *
 * The easing is expo-out so the number lands softly. Honours
 * `prefers-reduced-motion` by snapping to the target instantly. Uses an
 * IntersectionObserver so off-screen counters don't burn frames.
 *
 * Robustness: the easing runs on requestAnimationFrame, which the browser
 * PAUSES while a tab is in the background. A timer-based "ensure" snap (rAF
 * survives, timers don't) guarantees the counter always lands on its real
 * value even if it was loaded in a hidden tab and never got to animate. The
 * label always carries the true value for assistive tech.
 *
 * @param {number} value          The final number to display.
 * @param {number} [duration=1100]  Animation length in ms.
 * @param {string} [className]    Pass-through.
 * @param {(n:number) => string} [format]  Custom formatter. Default:
 *   locale-aware integer with grouping (negative-zero normalised to 0).
 */
export default function CountUp({ value, duration = 1100, className = "", format }) {
  const ref = useRef(null);
  const [shown, setShown] = useState(0);
  // Track the last displayed value so a later target change eases from where
  // the counter currently sits rather than snapping back to 0.
  const shownRef = useRef(0);
  const startedRef = useRef(false);
  const rafRef = useRef(0);

  useEffect(() => {
    if (!Number.isFinite(value)) {
      setShown(value);
      return;
    }
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setShown(value);
      shownRef.current = value;
      startedRef.current = true;
      return;
    }

    let cancelled = false;
    let fallbackTimer = null;
    const run = (from) => {
      const t0 = performance.now();
      const step = (ts) => {
        if (cancelled) return;
        const t = Math.min(1, (ts - t0) / duration);
        const eased = 1 - Math.pow(1 - t, 4); // expo-out
        const next = t === 1 ? value : from + (value - from) * eased;
        shownRef.current = next;
        setShown(next);
        if (t < 1) rafRef.current = requestAnimationFrame(step);
      };
      rafRef.current = requestAnimationFrame(step);
    };

    // Hard guarantee, independent of requestAnimationFrame: if the easing
    // hasn't reached the target by the time it should have (e.g. the tab was
    // in the background, where rAF is paused), snap to the real value.
    const ensure = setTimeout(() => {
      if (!cancelled && Math.round(shownRef.current) !== Math.round(value)) {
        shownRef.current = value;
        setShown(value);
      }
    }, duration + 400);

    if (startedRef.current) {
      // A target change after the first reveal: ease from the current display.
      run(shownRef.current);
      return () => {
        cancelled = true;
        clearTimeout(ensure);
        cancelAnimationFrame(rafRef.current);
      };
    }

    // First reveal: count up from 0 once on-screen. The IntersectionObserver
    // is the primary trigger; a short timer guarantees the count still fires
    // when the card mounts already in view or the observer is slow.
    const el = ref.current;
    const begin = () => {
      if (startedRef.current) return;
      startedRef.current = true;
      run(0);
    };
    let io = null;
    if (el && typeof IntersectionObserver !== "undefined") {
      io = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) {
            begin();
            io.disconnect();
          }
        },
        { threshold: 0.2 },
      );
      io.observe(el);
    }
    fallbackTimer = setTimeout(() => {
      begin();
      io?.disconnect();
    }, 240);

    return () => {
      cancelled = true;
      clearTimeout(ensure);
      clearTimeout(fallbackTimer);
      io?.disconnect();
      cancelAnimationFrame(rafRef.current);
    };
  }, [value, duration]);

  const fmt =
    format ??
    ((n) => {
      const r = Math.round(n);
      // Math.round can yield -0 from a tiny negative float; V8 renders that
      // as the string "-0", so normalise it back to a plain 0.
      return (Object.is(r, -0) ? 0 : r).toLocaleString(appLocale());
    });

  return (
    <span ref={ref} className={className} aria-label={String(value)}>
      {fmt(shown)}
    </span>
  );
}

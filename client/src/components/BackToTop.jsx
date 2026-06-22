import { useEffect, useState } from "react";
import { ChevronUp } from "lucide-react";
import { useReducedMotion } from "motion/react";
import { useT } from "../i18n/index.jsx";

const RADIUS = 23;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS; // ≈ 144.5, for the 52px ring

/**
 * Floating "back to top" button for long pages (Direction A · "Anneau de
 * progression").
 *
 * A circular gold ring that fills with reading progress, a chevron at its
 * centre. Deliberately NO square chrome: the only surfaces are the SVG ring +
 * a faint circular noir disc, and the focus ring is a `box-shadow` (Tailwind
 * `ring-*`) so it follows the circle — never a square `outline`.
 *
 * Behaviour (per NN/g + a11y refs):
 * - Appears only once the reader is ~1.2 screens down; fades + rises in and
 *   never moves afterwards (no jiggle).
 * - Click smooth-scrolls to the top (instant under prefers-reduced-motion) and
 *   drops focus on <main> so keyboard/SR users land at the top too.
 * - Sits bottom-right, lifted above the mobile tab bar + safe-area when present.
 *
 * GPU-light: one rAF-coalesced scroll listener (mirrors ChapterNav's spy) and
 * only transform/opacity transitions.
 */
export default function BackToTop({ hasTabBar = false }) {
  const t = useT();
  const reduce = useReducedMotion();
  const [visible, setVisible] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    let frame = 0;
    const compute = () => {
      frame = 0;
      const el = document.documentElement;
      const max = el.scrollHeight - el.clientHeight;
      const y = window.scrollY;
      setProgress(max > 0 ? Math.min(1, Math.max(0, y / max)) : 0);
      setVisible(y > Math.max(400, window.innerHeight * 1.2));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(compute);
    };
    compute();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  const toTop = () => {
    window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
    // Drop focus at the top for keyboard / screen-reader users (preventScroll so
    // it doesn't fight the smooth scroll).
    document.getElementById("fc-main")?.focus({ preventScroll: true });
  };

  const label = t("a11y.back_to_top", { default: "Remonter en haut" });

  return (
    <button
      type="button"
      onClick={toTop}
      aria-label={label}
      title={label}
      tabIndex={visible ? 0 : -1}
      aria-hidden={visible ? undefined : true}
      className={`group fixed right-4 lg:right-6 z-30 grid h-[52px] w-[52px] place-items-center rounded-full bg-[color-mix(in_oklab,var(--color-noir)_70%,transparent)] text-[var(--color-or)] cursor-pointer transition-[opacity,transform] duration-300 ease-out motion-reduce:transition-none focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-or)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-noir)] bottom-[calc(env(safe-area-inset-bottom)+1rem)] lg:bottom-6 ${
        hasTabBar ? "max-lg:bottom-[calc(3.5rem+env(safe-area-inset-bottom)+0.875rem)]" : ""
      } ${
        visible ? "opacity-100 translate-y-0" : "pointer-events-none translate-y-3 opacity-0"
      }`}
    >
      {/* Progress ring — faint gold track + a gold arc that tracks reading
          progress. Rotated -90° so it grows from the top. The <svg> has no fill
          or border, so the only visible chrome is circular (no square outline). */}
      <svg viewBox="0 0 52 52" className="absolute inset-0 h-full w-full -rotate-90" aria-hidden>
        <circle
          cx="26"
          cy="26"
          r={RADIUS}
          fill="none"
          stroke="var(--color-or)"
          strokeOpacity="0.18"
          strokeWidth="2"
        />
        <circle
          cx="26"
          cy="26"
          r={RADIUS}
          fill="none"
          stroke="var(--color-or)"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={CIRCUMFERENCE * (1 - progress)}
        />
      </svg>
      <ChevronUp
        aria-hidden
        size={20}
        strokeWidth={2}
        className="relative transition-transform duration-200 ease-out group-hover:-translate-y-0.5 motion-reduce:transition-none"
      />
    </button>
  );
}

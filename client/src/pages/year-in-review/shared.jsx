import Reveal from "../../components/motion/Reveal.jsx";
import Card from "../../components/Card.jsx";
import { appLocale } from "../../lib/locale.js";

/**
 * Page-local helpers + the editorial "chapter" card shared by the
 * Year-in-Review sections. Kept here so each section file stays focused on
 * its own data shape.
 *
 * Colour code (Direction A, tokens only): gold (金) = value/spend, hanko-red
 * (朱) = loss (cancellations, declines), jade = the calm third accent for
 * favourites / openings / the ledger high-water mark.
 */

/** color-mix helper — keeps accent translucency in oklab, theme-var safe. */
export function mix(accentVar, pct) {
  return `color-mix(in oklab, ${accentVar} ${pct}%, transparent)`;
}

export const ACCENT_GOLD = "var(--color-or)";
export const ACCENT_RED = "var(--color-laque-bright)";
export const ACCENT_JADE = "var(--color-jade)";

/** Locale-aware number, no trailing zeros unless significant. */
export function fmtNumber(n, maxFrac = 2) {
  return Number(n).toLocaleString(appLocale(), {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxFrac,
  });
}

/**
 * EditorialChapter — a `Card` opened by a kicker sub-label + accent hairline +
 * a faint kanji section marker in the corner. The recurring "chapter" wrapper
 * for the recap. `break-inside:avoid` keeps a chapter from being sliced across
 * printed pages.
 */
export function EditorialChapter({
  kicker,
  kanji,
  accent = ACCENT_GOLD,
  className = "",
  i = 0,
  children,
}) {
  return (
    <Reveal as="div" y={24} delay={i * 0.04} className="mt-8">
      <Card
        className={`relative p-7 overflow-hidden ${className}`}
        style={{ breakInside: "avoid" }}
      >
        {kanji ? (
          <span
            aria-hidden
            className="ja absolute -top-3 right-4 text-[5.5rem] leading-none select-none pointer-events-none"
            style={{ color: mix(accent, 12) }}
          >
            {kanji}
          </span>
        ) : null}
        <p className="micro relative inline-flex items-center gap-2">
          <span
            aria-hidden
            className="inline-block w-5 h-px"
            style={{ background: mix(accent, 80) }}
          />
          {kicker}
        </p>
        <div className="relative mt-4">{children}</div>
      </Card>
    </Reveal>
  );
}

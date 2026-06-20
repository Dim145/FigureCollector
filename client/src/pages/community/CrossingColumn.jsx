import Card from "../../components/Card.jsx";
import Reveal from "../../components/motion/Reveal.jsx";
import { mix } from "./crossingsConstants.js";

/**
 * One crossing column: an accent-tinted header (kanji + eyebrow + a count
 * chip), a gold-rule-style divider, then the list (cards / ledger) and a quiet
 * footnote. Empty lists collapse to a watermark Card. The accent is per-column
 * (red = the reading nudge, gold = the dual value ledger) — Direction A:
 * red carries discovery energy, gold marks value.
 */
export default function CrossingColumn({
  kanji,
  accent,
  eyebrow,
  title,
  count,
  caption,
  empty,
  isEmpty,
  children,
  delay = 0,
}) {
  return (
    <Reveal as="section" delay={delay} y={24} className="relative">
      <header className="mb-4">
        <p className="micro flex items-center gap-2" style={{ color: mix(accent, 85) }}>
          <span
            className="ja not-italic text-base leading-none"
            aria-hidden
            style={{ color: accent }}
          >
            {kanji}
          </span>
          {eyebrow}
        </p>
        <div className="flex items-baseline justify-between gap-3 mt-2">
          <h2 className="display text-2xl sm:text-[1.6rem] text-[var(--on-surface)] leading-tight">
            {title}
          </h2>
          <span
            className="label-mono px-2 py-0.5 tabular-nums shrink-0"
            style={{
              color: accent,
              background: mix(accent, 12),
              border: `1px solid ${mix(accent, 32)}`,
              borderRadius: "var(--radius-pill)",
            }}
          >
            {count}
          </span>
        </div>
        <div
          className="h-px mt-4"
          style={{ background: `linear-gradient(90deg, ${mix(accent, 60)}, transparent)` }}
        />
      </header>

      {isEmpty ? (
        <Card className="p-8 text-center relative overflow-hidden">
          <span
            aria-hidden
            className="ja absolute -top-4 -right-3 text-[7rem] leading-none select-none"
            style={{ color: mix(accent, 10) }}
          >
            {kanji}
          </span>
          <p className="relative text-[var(--on-surface-muted)] italic leading-relaxed">{empty}</p>
        </Card>
      ) : (
        <>
          {children}
          <p className="mt-4 text-[11px] text-[var(--on-surface-subtle)] leading-relaxed">
            {caption}
          </p>
        </>
      )}
    </Reveal>
  );
}

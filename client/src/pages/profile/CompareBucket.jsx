import Card from "../../components/Card.jsx";
import FigureCard from "../../components/FigureCard.jsx";
import Reveal from "../../components/motion/Reveal.jsx";
import { mixAccent } from "./mixAccent.js";

/**
 * One bucket column of the compare readout: an accent-tinted header (kanji +
 * title + count chip), a gold-rule divider, then the `FigureCard` list — the
 * actual specimens that are yours-only / common / theirs-only. Empty buckets
 * show a quiet `Card` with a faint kanji watermark instead of a bare gap.
 *
 * `accent` follows the palette: hanko-red for *your* pieces, gold for shared,
 * ivoire for theirs (the single hot accent stays on your side).
 */
export default function CompareBucket({ title, kanji, count, entries, accent, t, delay = 0 }) {
  return (
    <Reveal as="section" delay={delay} y={24} className="relative">
      <header className="flex items-baseline justify-between gap-3 mb-3">
        <h2 className="display text-2xl flex items-baseline gap-2.5" style={{ color: accent }}>
          <span className="ja text-base leading-none opacity-70" aria-hidden>
            {kanji}
          </span>
          {title}
        </h2>
        <span
          className="font-mono text-xs px-2 py-0.5 tabular-nums"
          style={{
            color: accent,
            background: mixAccent(accent, 12),
            border: `1px solid ${mixAccent(accent, 32)}`,
          }}
        >
          {count}
        </span>
      </header>
      <div
        className="h-px mb-5"
        style={{ background: `linear-gradient(90deg, ${mixAccent(accent, 60)}, transparent)` }}
      />
      {entries.length === 0 ? (
        <Card className="p-8 text-center relative overflow-hidden">
          <span
            aria-hidden
            className="ja absolute -top-4 -right-3 text-[7rem] leading-none text-[var(--color-or)]/10 select-none"
          >
            {kanji}
          </span>
          <p className="relative text-[var(--color-ivoire-soft)] italic">
            {t("compare.bucket_empty", { default: "Rien de ce côté." })}
          </p>
        </Card>
      ) : (
        <ul className="space-y-4">
          {entries.map((e, i) => (
            <Reveal as="li" key={e.figure_id} delay={Math.min(i, 7) * 0.04} y={18}>
              <FigureCard
                figureId={e.figure_id}
                href={`/figures/${e.figure_id}`}
                name={e.figure_name}
                type={e.figure_type}
                manufacturer={e.manufacturer_name}
                imageUrl={e.figure_image}
              />
            </Reveal>
          ))}
        </ul>
      )}
    </Reveal>
  );
}

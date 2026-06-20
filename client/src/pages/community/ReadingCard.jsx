import FigureCard from "../../components/FigureCard.jsx";
import Reveal from "../../components/motion/Reveal.jsx";
import { clampPct, mix } from "./crossingsConstants.js";

/**
 * Left-column entry — a figure you don't own from a series you read. The
 * catalogue specimen (FigureCard) is the hero; a manga-side ledger strip below
 * names the matched series + your reading progress, bridged by a 連 mark. The
 * accent is hanko-red (the discovery / "add to wishlist" nudge).
 */
export default function ReadingCard({ r, t, i }) {
  const pct = clampPct(r.read_percent);
  const progress =
    pct >= 100
      ? t("manga.pill.read_full")
      : t("manga.pill.vol", { owned: r.volumes_owned ?? 0, total: r.volumes ?? 0 });
  const accent = "var(--color-laque-bright)";
  return (
    <Reveal as="li" delay={Math.min(i, 7) * 0.04} y={18} className="flex flex-col">
      <FigureCard
        figureId={r.id}
        href={`/figures/${r.id}`}
        name={r.name}
        type={r.figure_type}
        imageUrl={r.image}
      />
      {/* Manga-side ledger strip — the crossing's other half. */}
      <div
        className="mt-2 flex items-center gap-2 px-3 py-2"
        style={{ background: mix(accent, 7), borderLeft: `2px solid ${mix(accent, 65)}` }}
      >
        <span aria-hidden className="ja text-sm leading-none" style={{ color: accent }}>
          連
        </span>
        <span className="label-mono text-[var(--on-surface-muted)] truncate flex-1 min-w-0 normal-case tracking-normal">
          {r.series_name || r.manga_name}
        </span>
        <Pill accent={accent}>{progress}</Pill>
      </div>
    </Reveal>
  );
}

/** A hairline accent chip — uppercase, tracked, accent-tinted border + text. */
function Pill({ accent, children }) {
  return (
    <span
      className="text-[9px] uppercase tracking-[0.12em] px-[0.5em] py-[0.18em] whitespace-nowrap"
      style={{
        color: accent,
        borderColor: mix(accent, 42),
        borderWidth: 1,
        borderStyle: "solid",
        borderRadius: "var(--radius-pill)",
      }}
    >
      {children}
    </span>
  );
}

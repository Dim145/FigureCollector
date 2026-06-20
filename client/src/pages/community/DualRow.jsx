import Reveal from "../../components/motion/Reveal.jsx";
import { clampPct, mix } from "./crossingsConstants.js";

/**
 * Right-column row — a series present on both shelves, in a gold value ledger.
 * 双 (pair) bridges the manga + figure sides; the figure count is the value
 * note (gold figural), the reading percent rides alongside.
 */
export default function DualRow({ d, t, i }) {
  const pct = clampPct(d.read_percent);
  const figures = d.figure_count ?? 0;
  const gold = "var(--accent)";
  return (
    <Reveal
      as="li"
      delay={Math.min(i, 7) * 0.04}
      y={14}
      className="flex items-center gap-3 px-4 py-3.5"
    >
      <span aria-hidden className="ja shrink-0 text-base leading-none" style={{ color: gold }}>
        双
      </span>
      <div className="flex-1 min-w-0">
        <b className="display text-[1.05rem] text-[var(--on-surface)] block leading-[1.2] truncate not-italic font-normal">
          {d.series_name || d.manga_name}
        </b>
        <span className="label-mono text-[var(--on-surface-subtle)] truncate block normal-case tracking-normal">
          {d.manga_name}
        </span>
      </div>
      <div className="flex flex-col items-end gap-1.5 shrink-0">
        <span className="flex items-baseline gap-1.5" title={t("manga.croisements.dual.sub")}>
          <span className="figural text-2xl leading-none" style={{ color: gold }}>
            {figures}
          </span>
          <span className="micro normal-case tracking-normal text-[var(--on-surface-subtle)]">
            {t("croisements.dual.pieces", { default: "pièces" })}
          </span>
        </span>
        <Pill accent={gold}>{t("manga.pill.percent", { pct })}</Pill>
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

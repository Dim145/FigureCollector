import Card from "../../components/Card.jsx";
import { mixAccent } from "./mixAccent.js";

/**
 * The head-to-head "vs" spread: your shelf vs theirs, the shared count meeting
 * on a central 対 (facing / versus) node.
 *
 * Desktop (`sm+`): a 1fr · auto · 1fr row — your side right-aligned, the spine
 * in the middle, their side left-aligned, reading toward each other.
 * Mobile: stacks to one column — your plaque, the shared node, their plaque —
 * so nothing is cramped and the numbers stay legible (≥44px hit areas).
 *
 * Palette stays on-direction: hanko-red is *your* side (the only hot accent),
 * gold marks the shared node (value / overlap), ivoire keeps their side quiet.
 */
export default function CompareShelf({ metrics, youName, themName, t }) {
  return (
    <Card className="p-6 sm:p-8">
      {/* sm+ : three columns reading toward the spine. <sm : single column. */}
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr] items-center gap-6 sm:gap-8">
        <ShelfSide
          align="right"
          eyebrow={t("compare.side.you", { default: "Votre vitrine" })}
          name={youName}
          total={metrics.yoursTotal}
          only={metrics.yoursOnly}
          onlyLabel={t("compare.bucket.yours_only")}
          accent="var(--color-laque-bright)"
        />
        <VsSpine affinity={metrics.affinity} common={metrics.common} t={t} />
        <ShelfSide
          align="left"
          eyebrow={t("compare.side.them", { default: "Sa vitrine" })}
          name={themName}
          total={metrics.theirsTotal}
          only={metrics.theirsOnly}
          onlyLabel={t("compare.bucket.theirs_only")}
          accent="var(--color-ivoire)"
        />
      </div>
    </Card>
  );
}

/**
 * One side of the head-to-head plaque: an eyebrow, the collector's name in
 * Fraunces, the total piece count (oldstyle / tabular figures), and the "only"
 * tally. `align` mirrors your side (right) against theirs (left) so they read
 * toward the central spine on desktop; both center on mobile (single column).
 */
function ShelfSide({ align, eyebrow, name, total, only, onlyLabel, accent }) {
  const right = align === "right";
  const desktopAlign = right ? "sm:text-right" : "sm:text-left";
  return (
    <div className={`text-center ${desktopAlign}`}>
      <p className="micro-tight" style={{ color: mixAccent(accent, 75) }}>
        {eyebrow}
      </p>
      <p className="display text-lg sm:text-xl mt-1 text-[var(--color-ivoire)] truncate">{name}</p>
      <p
        className="figural tabular-nums text-4xl sm:text-5xl mt-2 leading-none"
        style={{ color: accent }}
      >
        {total}
      </p>
      <p className="micro-tight text-[var(--color-ivoire-soft)]/70 mt-2">
        <span className="tabular-nums">{only}</span> · {onlyLabel}
      </p>
    </div>
  );
}

/**
 * The central spine: a gold affinity medallion (a ring filled to the
 * server-computed taste-match %) where the two shelves meet, with the shared
 * count beneath it. Reuses the back-to-top ring language (instant, GPU-light
 * SVG). On mobile the flanking hairlines read as a vertical connector between
 * the stacked plaques.
 */
function VsSpine({ affinity, common, t }) {
  const r = 30;
  const circ = 2 * Math.PI * r;
  return (
    <div className="flex flex-col items-center justify-center px-1 sm:px-2">
      <span
        aria-hidden
        className="block w-px h-6 sm:h-8"
        style={{ background: `linear-gradient(${mixAccent("var(--color-or)", 50)}, transparent)` }}
      />
      <span
        role="img"
        aria-label={t("compare.affinity_aria", { pct: affinity })}
        className="relative my-2 grid place-items-center w-[72px] h-[72px]"
      >
        <svg
          viewBox="0 0 72 72"
          className="absolute inset-0 h-full w-full -rotate-90"
          aria-hidden
        >
          <circle cx="36" cy="36" r={r} fill="none" stroke="var(--color-or)" strokeOpacity="0.3" strokeWidth="3" />
          <circle
            cx="36"
            cy="36"
            r={r}
            fill="none"
            stroke="var(--color-or)"
            strokeWidth="3.5"
            strokeLinecap="round"
            strokeDasharray={circ}
            strokeDashoffset={circ * (1 - affinity / 100)}
          />
        </svg>
        <span aria-hidden className="figural tabular-nums text-2xl leading-none text-[var(--color-or)]">
          {affinity}
          <span className="text-sm align-top">%</span>
        </span>
      </span>
      <span className="micro-tight text-[var(--color-or-pale)]/80">
        {t("compare.affinity_label", { default: "AFFINITÉ" })}
      </span>
      <span className="micro-tight text-[var(--color-ivoire-soft)]/60 mt-1">
        <span className="tabular-nums">{common}</span> · {t("compare.bucket.common")}
      </span>
      <span
        aria-hidden
        className="block w-px h-6 sm:h-8 mt-1"
        style={{ background: `linear-gradient(transparent, ${mixAccent("var(--color-or)", 50)})` }}
      />
    </div>
  );
}

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
        <VsSpine common={metrics.common} t={t} />
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
 * The central spine: a hairline with the shared count seated on a gold node and
 * a 対 mark — where the two shelves meet. On mobile the flanking hairlines read
 * as a vertical connector between the stacked plaques.
 */
function VsSpine({ common, t }) {
  return (
    <div className="flex flex-col items-center justify-center px-1 sm:px-2">
      <span
        aria-hidden
        className="block w-px h-8 sm:h-10"
        style={{ background: `linear-gradient(${mixAccent("var(--color-or)", 50)}, transparent)` }}
      />
      <span
        className="my-2 grid place-items-center w-14 h-14 sm:w-16 sm:h-16 rounded-full"
        style={{
          background: mixAccent("var(--color-or)", 10),
          border: `1px solid ${mixAccent("var(--color-or)", 40)}`,
          boxShadow: `inset 0 0 0 1px ${mixAccent("var(--color-or)", 8)}`,
        }}
      >
        <span className="ja text-base leading-none text-[var(--color-or-pale)]" aria-hidden>
          対
        </span>
        <span className="figural tabular-nums text-xl leading-none text-[var(--color-or)] mt-0.5">
          {common}
        </span>
      </span>
      <span className="micro-tight text-[var(--color-or-pale)]/80">
        {t("compare.bucket.common")}
      </span>
      <span
        aria-hidden
        className="block w-px h-8 sm:h-10"
        style={{ background: `linear-gradient(transparent, ${mixAccent("var(--color-or)", 50)})` }}
      />
    </div>
  );
}

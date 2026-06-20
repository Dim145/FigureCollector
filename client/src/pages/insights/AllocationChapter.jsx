import { useState } from "react";
import Card from "../../components/Card.jsx";
import Reveal from "../../components/motion/Reveal.jsx";
import { typeHue } from "../../lib/typeHue.js";
import ChapterRule from "./ChapterRule.jsx";
import { CHAPTER_ACCENT, colorMix, segmentColor } from "./chapterTheme.js";
import Donut from "./charts/Donut.jsx";

/**
 * III — Répartition. Two polar breakdowns (by type · by condition), each a
 * donut + an interactive legend that cross-highlights with the wedges. Desktop
 * = two columns; mobile = one. The donut wrapper scrolls inside its own well
 * on narrow screens.
 */
export default function AllocationChapter({ data, t }) {
  return (
    <>
      <ChapterRule
        id="ch-allocation"
        roman="III"
        label={t("stats.ch.allocation")}
        kanji="分"
        accent={CHAPTER_ACCENT.III}
      />
      <Reveal as="div" y={24} className="grid lg:grid-cols-2 gap-8">
        <PolarBreakdown
          title={t("stats.by_type.title")}
          kanji="像"
          t={t}
          typed
          rows={(data.by_type ?? []).map((r) => ({
            key: r.figure_type,
            label: t(`type.${r.figure_type}`, { default: r.figure_type }),
            count: Number(r.count) || 0,
          }))}
        />
        <PolarBreakdown
          title={t("stats.by_condition.title")}
          kanji="態"
          t={t}
          rows={(data.by_condition ?? []).map((r) => ({
            key: r.condition,
            label: t(`condition.${r.condition}`, { default: r.condition }),
            count: Number(r.count) || 0,
          }))}
        />
      </Reveal>
    </>
  );
}

function PolarBreakdown({ title, kanji, rows, t, typed = false }) {
  const total = rows.reduce((s, r) => s + r.count, 0);
  const top = [...rows].sort((a, b) => b.count - a.count)[0];
  const headerHue = typed && top ? typeHue(top.key) : "var(--color-or-pale)";
  // Shared active segment — drives both the donut (wedge pops, others dim) and
  // the legend (matching row lights up). Bidirectional.
  const [activeIndex, setActiveIndex] = useState(null);

  if (rows.length === 0) {
    return (
      <Card className="p-7">
        <p className="micro mb-4">{title}</p>
        <p className="text-[var(--color-ivoire-soft)] italic">—</p>
      </Card>
    );
  }
  return (
    <Card className="relative p-7">
      <p className="micro mb-5 inline-flex items-center gap-2">
        <span
          aria-hidden
          className="inline-block w-5 h-px"
          style={{ background: colorMix(headerHue, 75) }}
        />
        <span style={typed ? { color: headerHue } : undefined}>{title}</span>
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-[170px_1fr] gap-6 sm:gap-7 items-center">
        {/* Donut never shrinks below its 170px design size — it scrolls inside
            this well on a very narrow column rather than squashing. */}
        <div className="overflow-x-auto">
          <Donut
            rows={rows}
            kanji={kanji}
            total={total}
            activeIndex={activeIndex}
            setActiveIndex={setActiveIndex}
          />
        </div>
        <ol className="space-y-2.5">
          {rows.map((r, i) => {
            const share = total > 0 ? (r.count / total) * 100 : 0;
            return (
              <li
                key={r.key}
                className="legend-row flex items-baseline gap-3 text-sm"
                data-active={activeIndex === i}
                data-dim={activeIndex != null && activeIndex !== i}
                onMouseEnter={() => setActiveIndex(i)}
                onMouseLeave={() => setActiveIndex(null)}
                onFocus={() => setActiveIndex(i)}
                onBlur={() => setActiveIndex(null)}
                tabIndex={0}
              >
                <span
                  className="legend-swatch block w-2 h-2 shrink-0 self-start mt-1.5"
                  style={{ background: segmentColor(i) }}
                />
                <span className="legend-label flex-1 truncate">{r.label}</span>
                {typed ? (
                  <span
                    aria-hidden
                    className="block w-1.5 h-1.5 rounded-full shrink-0 self-center"
                    style={{
                      background: typeHue(r.key),
                      boxShadow: `0 0 6px ${colorMix(typeHue(r.key), 60)}`,
                    }}
                  />
                ) : null}
                <span className="legend-count font-mono text-[11px] tracking-wider">{r.count}</span>
                <span className="legend-share font-mono text-[10px] w-10 text-right">
                  {share.toFixed(0)}%
                </span>
              </li>
            );
          })}
        </ol>
      </div>
      {top ? (
        <p className="absolute top-7 right-7 text-right">
          <span className="micro-tight block">
            {rows.length > 1 ? t("stats.dominant") : t("stats.unique")}
          </span>
          <span
            className="display italic text-base"
            style={{ color: typed ? headerHue : "var(--color-or-pale)" }}
          >
            {top.label}
          </span>
        </p>
      ) : null}
      {rows.length > 1 ? (
        <p className="legend-hint micro-tight mt-5 text-center" data-quiet={activeIndex != null}>
          {t("stats.interact.hint")}
        </p>
      ) : null}
    </Card>
  );
}

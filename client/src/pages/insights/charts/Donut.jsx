import { Cell as RechartsCell, Pie as RechartsPie, PieChart as RechartsPieChart } from "recharts";
import { segmentColor } from "../chapterTheme.js";

/**
 * Donut breakdown (page-local) — Recharts PieChart in donut configuration.
 * Recharts handles the edge cases hand-rolled SVG got wrong (single segment
 * closing to a full ring, equal halves, paddings) and tree-shakes to just
 * PieChart + Pie + Cell.
 *
 * GPU-light: Recharts' own entry animation is OFF (`isAnimationActive={false}`)
 * — the hover state is fully controlled here so it links with the legend, and
 * the wrapper's subtle scale is CSS (honours prefers-reduced-motion via the
 * shared `.donut-*` rules).
 *
 * The centre kanji morphs to the active wedge's share on hover.
 */
export default function Donut({ rows, kanji, total, activeIndex, setActiveIndex }) {
  const size = 170;
  const data = rows.map((r, i) => ({
    name: r.label,
    value: r.count,
    fill: segmentColor(i),
  }));
  const active = activeIndex != null ? data[activeIndex] : null;
  const pct = active && total > 0 ? Math.round((active.value / total) * 100) : 0;

  return (
    <div
      className="donut-wrap relative"
      style={{ width: size, height: size }}
      data-active={activeIndex != null}
    >
      <RechartsPieChart width={size} height={size}>
        <RechartsPie
          data={data}
          cx="50%"
          cy="50%"
          innerRadius={26}
          outerRadius={size / 2 - 8}
          paddingAngle={data.length > 1 ? 1 : 0}
          dataKey="value"
          isAnimationActive={false}
          stroke="transparent"
          onMouseEnter={(_, idx) => setActiveIndex(idx)}
          onMouseLeave={() => setActiveIndex(null)}
        >
          {data.map((entry, i) => {
            const isActive = activeIndex === i;
            const dim = activeIndex != null && !isActive;
            return (
              <RechartsCell
                key={i}
                fill={entry.fill}
                fillOpacity={dim ? 0.28 : 1}
                stroke={isActive ? "var(--color-or-pale)" : "transparent"}
                strokeWidth={isActive ? 1.5 : 0}
              />
            );
          })}
        </RechartsPie>
      </RechartsPieChart>
      <span aria-hidden className="donut-center" data-active={activeIndex != null}>
        <span className="ja donut-kanji">{kanji}</span>
        <span className="donut-pct display">{pct}%</span>
      </span>
    </div>
  );
}

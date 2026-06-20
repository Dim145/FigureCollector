import { useState } from "react";
import Reveal from "../../../components/motion/Reveal.jsx";
import { colorMix } from "../chapterTheme.js";

/**
 * Press-strip year timeline (page-local) — letterpress counts above each bar,
 * indigo→gold gradient caps. Hovering/focusing a year isolates it (siblings
 * dim) and swaps the caption to a live readout. Reuses the `.press-*` classes
 * in index.css; the bar entrance + hover are CSS (reduced-motion respected
 * there). Wrapped in an `overflow-x:auto` well by the caller for mobile.
 */
export default function PressStrip({ data, t }) {
  const max = Math.max(1, ...data.map((d) => Number(d.count) || 0));
  const [hoveredYear, setHoveredYear] = useState(null);
  const hot = data.find((d) => d.year === hoveredYear) || null;
  return (
    <Reveal as="div" y={22} className="press-strip">
      <div
        className="press-grid"
        data-active={hoveredYear != null}
        style={{ gridTemplateColumns: `repeat(${data.length}, minmax(34px, 1fr))` }}
      >
        {data.map((d, i) => {
          const h = ((Number(d.count) || 0) / max) * 100;
          return (
            <div
              key={d.year}
              className="press-col"
              data-hot={d.year === hoveredYear}
              tabIndex={0}
              aria-label={t("stats.timeline.readout", { count: d.count, year: d.year })}
              onMouseEnter={() => setHoveredYear(d.year)}
              onMouseLeave={() => setHoveredYear(null)}
              onFocus={() => setHoveredYear(d.year)}
              onBlur={() => setHoveredYear(null)}
            >
              <span className="press-count">
                <span className="press-count-n">{d.count}</span>
              </span>
              <div
                className="press-bar"
                style={{
                  height: `${h}%`,
                  animationDelay: `${i * 60}ms`,
                  background: `linear-gradient(to top, ${colorMix(
                    "var(--color-indigo)",
                    80,
                  )}, ${colorMix("var(--color-indigo-bright)", 60)} 55%, ${colorMix(
                    "var(--color-or-pale)",
                    75,
                  )} 100%)`,
                }}
              />
              <span className="press-year">{d.year}</span>
            </div>
          );
        })}
      </div>
      <p className="press-readout" data-active={hot != null} aria-live="polite">
        {hot
          ? t("stats.timeline.readout", { count: hot.count, year: hot.year })
          : t("stats.timeline.caption")}
      </p>
    </Reveal>
  );
}

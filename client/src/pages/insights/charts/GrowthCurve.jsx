import { useRef, useState } from "react";
import { appLocale } from "../../../lib/locale.js";
import { fmtMoney } from "../../../lib/money.js";

/**
 * "Collection over time" (#10) — a dual line over the monthly buckets: a gold
 * cumulative-SPEND curve (already converted into the display currency by the
 * caller) and a jade cumulative-PIECES curve, each on its own y-scale (spend
 * left, pieces right). Hand-rolled SVG in the same Direction-A "ledger" hand as
 * PriceHistory's StepChart: gold hairline grid, mono left labels, a hover
 * read-out in a noir-deep box, rotated-square markers. GPU-light by
 * construction — flat strokes/fills, no gradients/blur/animation; hover is a
 * single positioned div.
 *
 * Props:
 *   points   : sorted `{ t, label, items, spend }` (spend may be null when the
 *              display currency couldn't be resolved — then only the items line
 *              draws and the spend axis is hidden).
 *   currency : display currency for the spend axis labels.
 *   locale   : formatting locale.
 *   t        : translator.
 *   height   : svg height (viewBox units).
 */
const OR = "var(--color-or)";
const JADE = "var(--color-jade)";

export default function GrowthCurve({ points, currency, locale, t, height = 200 }) {
  const [hover, setHover] = useState(null);
  const svgRef = useRef(null);
  if (!points || points.length < 1) return null;

  const W = 600;
  const PAD_L = 52;
  const PAD_R = 46;
  const PAD_T = 16;
  const PAD_B = 28;

  const t0 = points[0].t;
  const span = Math.max(1, points[points.length - 1].t - t0);
  // Spend may be absent (unconvertible) — guard the axis on whether ANY point
  // carries a finite spend value.
  const spends = points.map((p) => (Number.isFinite(p.spend) ? p.spend : null));
  const hasSpend = spends.some((s) => s != null);
  const spendMax = hasSpend ? Math.max(...spends.filter((s) => s != null), 1) : 1;
  const itemsMax = Math.max(...points.map((p) => p.items), 1);

  const x = (tm) =>
    points.length === 1 ? (W - PAD_R + PAD_L) / 2 : PAD_L + ((tm - t0) / span) * (W - PAD_L - PAD_R);
  const ySpend = (v) => PAD_T + (1 - v / spendMax) * (height - PAD_T - PAD_B);
  const yItems = (v) => PAD_T + (1 - v / itemsMax) * (height - PAD_T - PAD_B);

  const linePath = (accessor, yfn) => {
    let d = "";
    for (let i = 0; i < points.length; i++) {
      const v = accessor(points[i]);
      if (v == null || !Number.isFinite(v)) continue;
      d += `${d ? " L" : "M"}${x(points[i].t).toFixed(1)} ${yfn(v).toFixed(1)}`;
    }
    return d;
  };

  const gridFracs = [1, 0.5, 0];
  const fmtTick = (ms) =>
    new Date(ms).toLocaleDateString(locale, { month: "short", year: "2-digit" }).toUpperCase();
  const tickTs = [...new Set([0, 1 / 3, 2 / 3, 1].map((f) => Math.round(t0 + span * f)))];
  const tickLabels = [...new Set(tickTs.map((ms) => fmtTick(ms)))];

  const onMove = (e) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const px = ((e.clientX - rect.left) / rect.width) * W;
    let best = null;
    for (let i = 0; i < points.length; i++) {
      const dx = Math.abs(x(points[i].t) - px);
      if (!best || dx < best.dx) best = { dx, i };
    }
    if (best) setHover(best.i);
  };

  const h = hover != null ? points[hover] : null;

  return (
    <div className="relative">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${height}`}
        className="block w-full"
        role="img"
        aria-label={t("stats.growth.chart_aria")}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        {/* Gold hairline grid + left (spend) axis labels */}
        {gridFracs.map((f, i) => {
          const yy = PAD_T + (1 - f) * (height - PAD_T - PAD_B);
          return (
            <g key={i}>
              <line
                x1={PAD_L}
                y1={yy}
                x2={W - PAD_R}
                y2={yy}
                stroke="color-mix(in oklab, var(--color-or) 14%, transparent)"
                strokeWidth="1"
              />
              {hasSpend ? (
                <text
                  x={PAD_L - 6}
                  y={yy + 3}
                  textAnchor="end"
                  className="font-mono"
                  fontSize="9"
                  fill="var(--color-or-pale)"
                  opacity="0.8"
                >
                  {fmtMoney(spendMax * f, currency, locale)}
                </text>
              ) : null}
              {/* Right (items) axis labels */}
              <text
                x={W - PAD_R + 6}
                y={yy + 3}
                textAnchor="start"
                className="font-mono"
                fontSize="9"
                fill="var(--color-jade)"
                opacity="0.85"
              >
                {Math.round(itemsMax * f)}
              </text>
            </g>
          );
        })}

        {/* Base line */}
        <line
          x1={PAD_L}
          y1={height - PAD_B + 4}
          x2={W - PAD_R}
          y2={height - PAD_B + 4}
          stroke="color-mix(in oklab, var(--color-or) 28%, transparent)"
          strokeWidth="1"
        />
        {tickLabels.map((label, i) => (
          <text
            key={label}
            x={PAD_L + (i / Math.max(1, tickLabels.length - 1)) * (W - PAD_L - PAD_R - 24)}
            y={height - 9}
            fontSize="8"
            letterSpacing="2"
            fill="var(--color-ivoire-soft)"
            opacity="0.7"
          >
            {label}
          </text>
        ))}

        {/* Items line (jade) — drawn first so spend reads on top */}
        <path d={linePath((p) => p.items, yItems)} fill="none" stroke={JADE} strokeWidth="1.4" />
        {/* Spend line (gold) */}
        {hasSpend ? (
          <path
            d={linePath((p) => p.spend, ySpend)}
            fill="none"
            stroke={OR}
            strokeWidth="1.6"
          />
        ) : null}

        {/* Markers on the items line (the always-present series) */}
        {points.map((p, i) => (
          <rect
            key={`${p.t}-${i}`}
            x={x(p.t) - 2.4}
            y={yItems(p.items) - 2.4}
            width="4.8"
            height="4.8"
            transform={`rotate(45 ${x(p.t)} ${yItems(p.items)})`}
            fill={JADE}
            opacity={hover === i ? 1 : 0.7}
          />
        ))}

        {/* Hover guide line */}
        {h ? (
          <line
            x1={x(h.t)}
            y1={PAD_T}
            x2={x(h.t)}
            y2={height - PAD_B + 4}
            stroke="color-mix(in oklab, var(--color-or) 35%, transparent)"
            strokeWidth="1"
            strokeDasharray="2 3"
          />
        ) : null}
      </svg>

      {h ? (
        <div
          className="pointer-events-none absolute px-2.5 py-1.5 border text-left"
          style={{
            left: `${Math.min(78, Math.max(2, (x(h.t) / W) * 100))}%`,
            top: 0,
            background: "var(--color-noir-deep)",
            borderColor: "color-mix(in oklab, var(--color-or) 45%, transparent)",
          }}
        >
          <p className="micro-tight text-[8px]">
            {new Date(h.t).toLocaleDateString(locale, { month: "long", year: "numeric" })}
          </p>
          <p className="font-mono text-[11px] mt-0.5" style={{ color: JADE }}>
            {t("stats.growth.readout.items", { count: h.items })}
          </p>
          {Number.isFinite(h.spend) ? (
            <p className="font-mono text-[12px] text-[var(--color-ivoire)] mt-0.5">
              {fmtMoney(Math.round(h.spend), currency, locale)}
            </p>
          ) : null}
        </div>
      ) : null}

      {/* Legend */}
      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5">
        {hasSpend ? (
          <Legend swatch={OR} label={t("stats.growth.legend.spend")} />
        ) : null}
        <Legend swatch={JADE} label={t("stats.growth.legend.items")} />
      </div>
    </div>
  );
}

function Legend({ swatch, label }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.18em] text-[var(--color-ivoire-soft)]/80">
      <span aria-hidden className="inline-block w-4 h-px" style={{ background: swatch }} />
      {label}
    </span>
  );
}

// Re-export the bare locale helper so the chapter can format without re-importing.
export { appLocale };

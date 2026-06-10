import { useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { useFocusTrap } from "../hooks/useFocusTrap.js";
import { useT } from "../i18n/index.jsx";
import AccentTitle from "./AccentTitle.jsx";
import Button from "./Button.jsx";
import { fmtMoney } from "../lib/money.js";

/**
 * Price-history charts for the cote — Direction A "auction-ledger" hand.
 *
 * The data is `figure_price_history`: append-only CHANGE points written by the
 * price cron. Step curves (value holds until the next relevé) are therefore
 * the honest representation — no interpolation. Everything is hand-rolled
 * SVG: gold hairlines, a gold step path, rotated-square markers (jade = rise,
 * laque = drop), mono labels. GPU-light by construction — flat fills, no
 * gradients/blur/animation, hover handled with a single positioned div.
 */

const OR = "var(--color-or)";
const JADE = "var(--color-jade)";
const LAQUE = "var(--color-laque-bright)";

/** API rows → sorted chart points `{ t, v, currency, source, version }`. */
export function toSeries(rows) {
  return (rows ?? [])
    .map((r) => ({
      t: new Date(r.recorded_at).getTime(),
      v: Number(r.amount),
      currency: r.currency || null,
      source: r.source || null,
      version: r.matched_version || null,
    }))
    .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.v))
    .sort((a, b) => a.t - b.t);
}

/** First→last move of a series, or null when it can't be computed. */
export function seriesDelta(points) {
  if (!points || points.length < 2) return null;
  const first = points[0].v;
  const last = points[points.length - 1].v;
  if (!(first > 0)) return null;
  return { abs: last - first, pct: ((last - first) / first) * 100 };
}

/** Step path ("M … H … V …") extended to the right edge (value holds today). */
function stepPath(points, x, y, xEnd) {
  let d = `M${x(points[0].t).toFixed(1)} ${y(points[0].v).toFixed(1)}`;
  for (let i = 1; i < points.length; i++) {
    d += ` H${x(points[i].t).toFixed(1)} V${y(points[i].v).toFixed(1)}`;
  }
  return `${d} H${xEnd.toFixed(1)}`;
}

/** Value scale with a flat-series guard (a single price still draws a line). */
function valueBounds(points) {
  const vs = points.map((p) => p.v);
  let min = Math.min(...vs);
  let max = Math.max(...vs);
  if (max === min) {
    max += Math.max(1, max * 0.05);
    min -= Math.max(1, min * 0.05);
  }
  return [min, max];
}

/** Tiny inline step curve — the ranked-list / CoteGlance trend glyph. */
export function StepSparkline({ points, width = 96, height = 22 }) {
  if (!points || points.length < 2) return null;
  const t0 = points[0].t;
  // Time domain ends at the last relevé; the trailing H-segment to the right
  // edge conveys "holds today" without reading the clock during render.
  const span = Math.max(1, points[points.length - 1].t - t0);
  const [vMin, vMax] = valueBounds(points);
  const x = (t) => 2 + ((t - t0) / span) * (width - 9);
  const y = (v) => 3.5 + (1 - (v - vMin) / (vMax - vMin)) * (height - 7);
  const last = points[points.length - 1];
  const prev = points[points.length - 2];
  const cx = width - 5;
  const cy = y(last.v);
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      aria-hidden
      className="shrink-0"
    >
      <path d={stepPath(points, x, y, cx)} fill="none" stroke={OR} strokeWidth="1.2" />
      <rect
        x={cx - 2.6}
        y={cy - 2.6}
        width="5.2"
        height="5.2"
        transform={`rotate(45 ${cx} ${cy})`}
        fill={last.v >= prev.v ? JADE : LAQUE}
      />
    </svg>
  );
}

/**
 * The full ledger chart: gold hairline grid, mono €-labels on the left, date
 * labels along the base, change diamonds toned by direction, and a nearest-
 * point hover read-out (date · price · delta) in a noir-deep box.
 */
export function StepChart({ points, currency, locale, height = 190, t }) {
  const [hover, setHover] = useState(null);
  const svgRef = useRef(null);
  if (!points || points.length < 1) return null;

  const W = 600;
  const PAD_L = 50;
  const PAD_R = 10;
  const PAD_T = 14;
  const PAD_B = 26;
  const t0 = points[0].t;
  // Same clockless domain as the sparkline: [first relevé .. last relevé],
  // with the step path extended to the right edge ("holds today").
  const span = Math.max(1, points[points.length - 1].t - t0);
  const [vMin, vMax] = valueBounds(points);
  const x = (tm) => PAD_L + ((tm - t0) / span) * (W - PAD_L - PAD_R);
  const y = (v) => PAD_T + (1 - (v - vMin) / (vMax - vMin)) * (height - PAD_T - PAD_B);

  const gridVals = [vMax, (vMin + vMax) / 2, vMin];
  const fmtTick = (ms) =>
    new Date(ms)
      .toLocaleDateString(locale, { month: "short", year: "2-digit" })
      .toUpperCase();
  // 4 evenly-spread time ticks, deduped (short ranges collapse to fewer).
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
  const hPrev = hover != null && hover > 0 ? points[hover - 1] : null;
  const hDelta = h && hPrev ? h.v - hPrev.v : null;

  return (
    <div className="relative">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${height}`}
        className="block w-full"
        role="img"
        aria-label={t("cote.history.chart_aria")}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        {gridVals.map((v, i) => (
          <g key={i}>
            <line
              x1={PAD_L}
              y1={y(v)}
              x2={W - PAD_R}
              y2={y(v)}
              stroke="color-mix(in oklab, var(--color-or) 14%, transparent)"
              strokeWidth="1"
            />
            <text
              x={PAD_L - 6}
              y={y(v) + 3}
              textAnchor="end"
              className="font-mono"
              fontSize="9"
              fill="var(--color-or-pale)"
              opacity="0.8"
            >
              {fmtMoney(v, currency, locale)}
            </text>
          </g>
        ))}
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
            x={PAD_L + (i / Math.max(1, tickLabels.length - 1)) * (W - PAD_L - PAD_R - 30)}
            y={height - 8}
            fontSize="8"
            letterSpacing="2"
            fill="var(--color-ivoire-soft)"
            opacity="0.7"
          >
            {label}
          </text>
        ))}

        <path
          d={stepPath(points, x, y, W - PAD_R)}
          fill="none"
          stroke={OR}
          strokeWidth="1.6"
        />
        {points.map((p, i) => {
          if (i === 0) return null;
          const tone = p.v >= points[i - 1].v ? JADE : LAQUE;
          return (
            <rect
              key={`${p.t}-${i}`}
              x={x(p.t) - 4}
              y={y(p.v) - 4}
              width="8"
              height="8"
              transform={`rotate(45 ${x(p.t)} ${y(p.v)})`}
              fill={tone}
            />
          );
        })}
        {h ? (
          <line
            x1={x(h.t)}
            y1={y(h.v)}
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
            left: `${Math.min(82, Math.max(2, (x(h.t) / W) * 100))}%`,
            top: 0,
            background: "var(--color-noir-deep)",
            borderColor: "color-mix(in oklab, var(--color-or) 45%, transparent)",
          }}
        >
          <p className="micro-tight text-[8px]">
            {new Date(h.t).toLocaleDateString(locale, {
              day: "2-digit",
              month: "short",
              year: "numeric",
            })}
          </p>
          <p className="font-mono text-[12px] text-[var(--color-ivoire)] mt-0.5">
            {fmtMoney(h.v, h.currency || currency, locale)}
          </p>
          {hDelta != null ? (
            <p
              className="font-mono text-[9px] mt-0.5"
              style={{ color: hDelta >= 0 ? JADE : LAQUE }}
            >
              {hDelta >= 0 ? "▲ +" : "▼ "}
              {fmtMoney(Math.abs(hDelta), h.currency || currency, locale)}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** The relevés ledger — reverse-chronological mono lines with per-line delta. */
export function PriceLedger({ points, currency, locale, t, showSource = true }) {
  if (!points?.length) return null;
  const rev = [...points].slice().reverse();
  return (
    <ul className="font-mono text-[10.5px] leading-[2.1] text-[var(--color-ivoire-soft)]">
      {rev.map((p, i) => {
        const prev = rev[i + 1] ?? null;
        const d = prev ? p.v - prev.v : null;
        return (
          <li key={`${p.t}-${i}`} className="flex flex-wrap items-baseline gap-x-2">
            <span className="tabular-nums">
              {new Date(p.t).toLocaleDateString(locale, {
                day: "2-digit",
                month: "short",
                year: "2-digit",
              })}
            </span>
            <span aria-hidden>·</span>
            <span className="text-[var(--color-ivoire)]">
              {fmtMoney(p.v, p.currency || currency, locale)}
            </span>
            {showSource && p.source ? (
              <>
                <span aria-hidden>·</span>
                <span>{p.source}</span>
              </>
            ) : null}
            {p.version ? (
              <>
                <span aria-hidden>·</span>
                <span className="truncate max-w-[14rem]">{p.version}</span>
              </>
            ) : null}
            <span aria-hidden>·</span>
            {d == null ? (
              <span className="text-[var(--color-or-pale)]">{t("cote.history.first")}</span>
            ) : (
              <span style={{ color: d >= 0 ? JADE : LAQUE }}>
                {d >= 0 ? "▲ +" : "▼ "}
                {fmtMoney(Math.abs(d), p.currency || currency, locale)}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The "évolution du prix" dialog (figure page). Direction-A modal on the
 * shared `.fig-pop` chrome: kicker · 推 · MARCHÉ, accent title, the step
 * chart, the relevés ledger, and a footer offering both exits — "Voir dans
 * la Cote →" (deep-links to the expanded row) and a ghost close.
 */
export default function PriceHistoryDialog({
  open,
  onClose,
  figureId,
  figureName,
  points,
  currency,
  locale,
}) {
  const t = useT();
  const ref = useRef(null);
  const titleId = useId();
  useFocusTrap(ref, { active: open, onClose });

  if (!open) return null;

  const source = points?.find((p) => p.source)?.source;

  return createPortal(
    <div role="dialog" aria-modal="true" onClick={onClose} className="fig-pop">
      <div
        ref={ref}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="fig-pop-card"
        aria-labelledby={titleId}
        style={{ maxWidth: "560px" }}
      >
        <p className="micro flex items-center gap-2.5">
          <span aria-hidden className="w-1 h-1 bg-[var(--color-laque-bright)] rotate-45" />
          {t("cote.history.kicker")}
          <span aria-hidden className="ja not-italic text-[var(--color-or)]">推</span>
          {t("cote.history.kicker_label")}
          <span className="flex-1" />
          {source ? (
            <span className="font-mono normal-case tracking-normal text-[9px] text-[var(--color-ivoire-soft)]">
              {t("cote.history.source", { s: source })}
            </span>
          ) : null}
        </p>
        <h2 id={titleId} className="display text-2xl text-[var(--color-ivoire)] mt-2.5">
          <AccentTitle text={figureName} />{" "}
          <span className="text-[var(--color-ivoire-soft)]">
            — {t("cote.history.title_suffix")}
          </span>
        </h2>
        <div className="gold-rule w-12 mt-3.5 mb-5" />

        <StepChart points={points} currency={currency} locale={locale} height={170} t={t} />

        <div className="mt-4 pt-3 border-t border-[var(--color-or)]/12 max-h-44 overflow-y-auto">
          <PriceLedger points={points} currency={currency} locale={locale} t={t} />
        </div>

        <div className="flex items-center justify-between gap-3 mt-5 pt-4 border-t border-[var(--color-or)]/12">
          <Link
            to={`/cote#figure-${figureId}`}
            onClick={onClose}
            className="micro text-[var(--color-or-pale)] hover:text-[var(--color-or)] transition-colors"
          >
            {t("cote.history.see_in_cote")} →
          </Link>
          <Button variant="ghost" onClick={onClose} data-autofocus>
            {t("cote.history.close")}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

import { useState } from "react";
import Card from "../../../components/Card.jsx";
import { appLocale } from "../../../lib/locale.js";
import { colorMix, fmtAmount } from "../chapterTheme.js";

/**
 * Price-scale "thermometer" (page-local) — a min→max track carrying ONLY shape
 * markers (end dots, médiane tick, moyenne diamond) so two marks can touch
 * without overlapping text; the numbers live in the collision-proof grid
 * below. Hovering a marker or its grid stat lights the same key. Reuses the
 * `.price-scale*` classes in index.css.
 */
export default function PriceThermometer({ dist, t }) {
  const locale = appLocale();
  const min = Number(dist.min) || 0;
  const max = Number(dist.max) || 1;
  const med = Number(dist.median) || 0;
  const avg = Number(dist.avg) || 0;
  const span = max - min || 1;
  const clampPos = (v) => Math.max(0, Math.min(100, ((v - min) / span) * 100));

  const [hoveredKey, setHoveredKey] = useState(null);
  const enter = (k) => () => setHoveredKey(k);
  const leave = () => setHoveredKey(null);

  const stats = [
    { key: "min", value: min, label: t("stats.price_dist.min"), glyph: null },
    { key: "median", value: med, label: t("stats.price_dist.median"), glyph: "│" },
    { key: "avg", value: avg, label: t("stats.price_dist.avg"), glyph: "◆" },
    { key: "max", value: max, label: t("stats.price_dist.max"), glyph: null },
  ];

  return (
    <Card className="p-7">
      <div className="flex items-baseline justify-between mb-5">
        <p className="micro inline-flex items-center gap-2">
          <span
            aria-hidden
            className="inline-block w-5 h-px"
            style={{ background: colorMix("var(--color-neon-cyan)", 75) }}
          />
          {t("stats.price_dist.title")}
        </p>
        <span className="brass-tab">{dist.currency}</span>
      </div>

      <div className="price-scale" aria-hidden>
        <span
          className="price-scale-track"
          style={{
            background: `linear-gradient(90deg, ${colorMix(
              "var(--color-neon-cyan)",
              30,
            )}, ${colorMix("var(--color-neon-cyan)", 75)}, ${colorMix(
              "var(--color-neon-cyan)",
              30,
            )})`,
          }}
        />
        <span
          className="price-scale-end ledger-tip"
          data-hot={hoveredKey === "min"}
          data-tip={`${t("stats.price_dist.min")} · ${fmtAmount(min, dist.currency, locale)}`}
          style={{ left: "0%" }}
          onMouseEnter={enter("min")}
          onMouseLeave={leave}
        />
        <span
          className="price-scale-end ledger-tip"
          data-hot={hoveredKey === "max"}
          data-tip={`${t("stats.price_dist.max")} · ${fmtAmount(max, dist.currency, locale)}`}
          style={{ left: "100%" }}
          onMouseEnter={enter("max")}
          onMouseLeave={leave}
        />
        <span
          className="price-scale-median ledger-tip"
          data-hot={hoveredKey === "median"}
          data-tip={`${t("stats.price_dist.median")} · ${fmtAmount(med, dist.currency, locale)}`}
          style={{ left: `${clampPos(med)}%`, background: "var(--color-neon-cyan)" }}
          onMouseEnter={enter("median")}
          onMouseLeave={leave}
        />
        <span
          className="price-scale-mean ledger-tip"
          data-hot={hoveredKey === "avg"}
          data-tip={`${t("stats.price_dist.avg")} · ${fmtAmount(avg, dist.currency, locale)}`}
          style={{ left: `${clampPos(avg)}%` }}
          onMouseEnter={enter("avg")}
          onMouseLeave={leave}
        />
      </div>

      <dl className="price-scale-grid">
        {stats.map((s) => (
          <div
            key={s.key}
            className="price-scale-stat"
            data-hot={hoveredKey === s.key}
            data-dim={hoveredKey != null && hoveredKey !== s.key}
            onMouseEnter={enter(s.key)}
            onMouseLeave={leave}
          >
            <dt>
              {s.glyph ? (
                <span aria-hidden className="price-scale-stat-glyph">
                  {s.glyph}
                </span>
              ) : null}
              {s.label}
            </dt>
            <dd>{fmtAmount(s.value, dist.currency, locale)}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

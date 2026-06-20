import { Section } from "../../components/layout/index.js";
import { SegmentedControl } from "../../components/ui/index.js";
import { StepChart, seriesDelta } from "../../components/PriceHistory.jsx";
import { fmtMoney } from "../../lib/money.js";

/**
 * « Évolution de la cote » — the reconstructed collection-value curve (dominant
 * currency), rebuilt by the orchestrator from the price cron's per-piece
 * relevés. A look-back SegmentedControl drives the range; the current value +
 * first→last move sit on the right. The chart itself is the shared, GPU-light
 * hand-rolled `StepChart` (no chart lib). The whole section self-hides when
 * there isn't enough history to draw a curve (parent passes `evo === null`).
 */
const RANGES = ["3m", "6m", "1y", "all"];

export default function CoteEvolution({ t, locale, evo, range, onRange, currency }) {
  if (!evo) return null;
  const delta = seriesDelta(evo);
  const last = evo[evo.length - 1];

  return (
    <Section
      kicker={t("cote.evo.kicker_full", { default: "ÉVOLUTION · 推 · COTE ESTIMÉE" })}
      title={t("cote.evo.title", { default: "Évolution de la cote" })}
      divider
      actions={
        <SegmentedControl
          size="sm"
          aria-label={t("cote.evo.range_label", { default: "Période" })}
          value={range}
          onChange={onRange}
          options={RANGES.map((r) => ({ value: r, label: t(`cote.evo.range.${r}`) }))}
        />
      }
    >
      <div className="flex items-baseline justify-end gap-2 mb-3 font-mono text-sm">
        <span className="text-[var(--on-surface)]">{fmtMoney(last.v, currency, locale)}</span>
        {delta ? (
          <span
            className="text-[12px]"
            style={{ color: delta.abs >= 0 ? "var(--success)" : "var(--danger)" }}
          >
            {delta.abs >= 0 ? "▲ +" : "▼ −"}
            {fmtMoney(Math.abs(delta.abs), currency, locale)} · {delta.abs >= 0 ? "+" : "−"}
            {Math.abs(delta.pct).toFixed(1)} %
          </span>
        ) : null}
      </div>

      <div className="w-full overflow-x-auto">
        <StepChart points={evo} currency={currency} locale={locale} height={210} t={t} />
      </div>
      <p className="mt-2 font-mono text-[9.5px] text-[var(--on-surface-subtle)]">
        {t("cote.evo.legend", { cur: currency })}
      </p>
    </Section>
  );
}

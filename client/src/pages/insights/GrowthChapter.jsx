import { useMemo } from "react";
import Card from "../../components/Card.jsx";
import Reveal from "../../components/motion/Reveal.jsx";
import { useDisplayCurrency } from "../../components/DisplayCurrencyProvider.jsx";
import { useMyTimeline } from "../../hooks/useStats.js";
import { appLocale } from "../../lib/locale.js";
import { toDisplay } from "../../lib/money.js";
import ChapterRule from "./ChapterRule.jsx";
import { CHAPTER_ACCENT, colorMix } from "./chapterTheme.js";
import GrowthCurve from "./charts/GrowthCurve.jsx";

/**
 * "La collection au fil du temps" (#10) — the growth curve, reconstructed from
 * existing owned-item data (no dedicated table). The server returns monthly
 * buckets `{ month, currency, items_added, spend_added }`; here we fold them
 * into a CUMULATIVE pieces curve + a CUMULATIVE spend curve, converting spend
 * into the display currency via the shared Money layer.
 *
 * Currency honesty: spend is summed in the display currency when conversion is
 * active (≈ marked). When it's off but the whole collection is single-currency,
 * we plot that native currency directly. Otherwise (multi-currency, no display
 * target) a cross-currency sum is meaningless, so we plot ONLY the pieces curve
 * and hide the spend axis. The `partial` flag surfaces when a bucket's currency
 * couldn't be converted and was left out.
 *
 * Self-hides to a graceful empty state when there are fewer than two monthly
 * points (one dot isn't a curve).
 */
export default function GrowthChapter({ t }) {
  const dc = useDisplayCurrency();
  const timeline = useMyTimeline();
  const rows = timeline.data;

  // `dc` is itself memoised by the provider (stable unless its inputs change);
  // `rows` comes straight off the query cache (stable across renders until the
  // data changes), so the whole computation only re-folds when inputs move.
  const { points, currency, partial } = useMemo(
    () => buildCurve(rows ?? [], dc),
    [rows, dc],
  );

  const tooFew = points.length < 2;

  return (
    <>
      <ChapterRule
        id="ch-growth"
        roman="V·"
        label={t("stats.ch.growth")}
        kanji="歴"
        accent={CHAPTER_ACCENT.V}
      />
      <Reveal as="div" y={24}>
        <Card className="relative p-7 overflow-hidden">
          <p className="micro mb-1 inline-flex items-center gap-2">
            <span
              aria-hidden
              className="inline-block w-5 h-px"
              style={{ background: colorMix(CHAPTER_ACCENT.V, 75) }}
            />
            {t("stats.growth.title")}
          </p>
          <p className="display italic text-lg mb-5" style={{ color: "var(--color-indigo)" }}>
            {t("stats.growth.kicker")}
          </p>

          {tooFew ? (
            <p className="text-[var(--color-ivoire-soft)] italic py-8">
              {t("stats.growth.empty")}
            </p>
          ) : (
            <>
              <GrowthCurve
                points={points}
                currency={currency}
                locale={appLocale()}
                t={t}
                height={210}
              />
              {partial ? (
                <p className="mt-3 text-[10px] uppercase tracking-[0.18em] text-[var(--color-laque-bright)]">
                  {t("stats.growth.partial")}
                </p>
              ) : null}
            </>
          )}
        </Card>
      </Reveal>
    </>
  );
}

/**
 * Fold the per-month/per-currency buckets into cumulative `{ t, label, items,
 * spend }` points. Returns the spend `currency` actually plotted (the display
 * currency, the single native one, or null) and a `partial` flag.
 */
function buildCurve(rows, dc) {
  if (!rows.length) return { points: [], currency: null, partial: false };

  // Distinct spend currencies present (ignore the synthetic '' bucket the
  // server emits for unpriced pieces — it carries items only, zero spend).
  const currencies = [...new Set(rows.map((r) => r.currency).filter((c) => c && c !== ""))];

  // Decide the spend target + how to convert a (amount, currency) bucket.
  let target = null;
  let convert = null; // (amount, currency) -> number | null  (null ⇒ skip, mark partial)
  if (dc.active && dc.ready && dc.display) {
    target = dc.display;
    convert = (amount, cur) => {
      const r = toDisplay(dc.rates, target, amount, cur);
      if (!r || r.unconvertible) return null;
      return r.amount;
    };
  } else if (currencies.length === 1) {
    // No display conversion, but one native currency → plot it as-is.
    target = currencies[0];
    convert = (amount, cur) => (cur === target ? Number(amount) : null);
  } else {
    // Multi-currency with no display target: a cross-currency sum is
    // meaningless, so plot pieces only (spend left null).
    target = null;
    convert = null;
  }

  // Aggregate per month: total items (currency-agnostic) + display-currency
  // spend delta. Track whether any spend bucket was dropped (partial).
  const byMonth = new Map();
  let partial = false;
  for (const r of rows) {
    const m = r.month;
    let agg = byMonth.get(m);
    if (!agg) {
      agg = { month: m, items: 0, spend: 0, spendKnown: false };
      byMonth.set(m, agg);
    }
    agg.items += Number(r.items_added) || 0;
    const amount = Number(r.spend_added) || 0;
    if (convert && amount > 0) {
      const v = convert(amount, r.currency);
      if (v == null) {
        partial = true;
      } else {
        agg.spend += v;
        agg.spendKnown = true;
      }
    }
  }

  const months = [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month));
  let cumItems = 0;
  let cumSpend = 0;
  const points = months.map((m) => {
    cumItems += m.items;
    cumSpend += m.spend;
    return {
      t: monthToMs(m.month),
      label: m.month,
      items: cumItems,
      // Only carry a spend value when we actually have a target to plot.
      spend: target ? cumSpend : null,
    };
  });

  return { points, currency: target, partial };
}

/** "YYYY-MM" → epoch ms at the first of that month (UTC, clockless). */
function monthToMs(ym) {
  const [y, m] = ym.split("-").map(Number);
  return Date.UTC(y, (m || 1) - 1, 1);
}

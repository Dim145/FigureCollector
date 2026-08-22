import { Link } from "react-router-dom";
import { Paperclip } from "lucide-react";
import { useMemo } from "react";
import Money from "../../components/Money.jsx";
import { useDisplayCurrency } from "../../components/DisplayCurrencyProvider.jsx";
import { effectiveValue, toDisplay } from "../../lib/money.js";

/** How many uncovered pieces to name before it stops being a to-do list. */
const TOP_UNCOVERED = 5;

/**
 * 保 Couverture — how much of the collection's **value** is backed by a
 * receipt, and which pieces are missing one.
 *
 * A dossier is only worth what it can prove, and today the gaps only surface
 * by opening the merged PDF — i.e. after the claim. Ranking by value turns a
 * vague chore ("scan your receipts") into a five-line to-do: the pieces where
 * a missing invoice actually costs money.
 *
 * Values go through the same manual → provider → MSRP chain as La Cote, so the
 * two pages can never disagree about what the shelf is worth.
 */
export default function CoveragePanel({ owned, t }) {
  const dc = useDisplayCurrency();

  const { pct, covered, total, uncovered, missingCount } = useMemo(() => {
    let covered = 0;
    let total = 0;
    const missing = [];
    for (const item of owned ?? []) {
      if (item.archived_at) continue;
      const v = effectiveValue(item);
      const amount = v == null ? 0 : (toDisplay(dc.rates, dc.display, v.amount, v.currency) ?? 0);
      total += amount;
      if (item.has_document) covered += amount;
      else missing.push({ item, amount });
    }
    missing.sort((a, b) => b.amount - a.amount);
    return {
      covered,
      total,
      pct: total > 0 ? Math.round((covered / total) * 100) : 0,
      uncovered: missing.slice(0, TOP_UNCOVERED),
      missingCount: missing.length,
    };
  }, [owned, dc.rates, dc.display]);

  if (!owned?.length) return null;

  return (
    <section
      className="bg-[var(--surface)] border border-[var(--border)] p-6 mb-6"
      style={{ borderRadius: "var(--radius-lg)", boxShadow: "var(--elevation-2)" }}
      aria-labelledby="coverage-title"
    >
      <p className="micro">{t("dossier.coverage.kicker", { default: "保 · COUVERTURE" })}</p>
      <h2 id="coverage-title" className="display text-2xl mt-1 text-[var(--color-ivoire)]">
        {t("dossier.coverage.title", { default: "Valeur adossée à un justificatif" })}
      </h2>
      <div className="gold-rule mt-3 mb-4 w-16 opacity-70" />

      <div className="flex items-baseline gap-3">
        <span className="display text-4xl tabular-nums text-[var(--color-or)]">{pct}%</span>
        <span className="text-[var(--color-ivoire-soft)] text-sm">
          <Money amount={covered} currency={dc.display} /> /{" "}
          <Money amount={total} currency={dc.display} />
        </span>
      </div>

      {/* Meter, not just a number: the bar is the thing you want to see fill.
          role=img + aria-label because the visual IS the information. */}
      <div
        className="mt-3 h-1.5 w-full overflow-hidden"
        style={{
          background: "color-mix(in oklab, var(--color-or) 12%, transparent)",
          borderRadius: "999px",
        }}
        role="img"
        aria-label={t("dossier.coverage.aria", { pct, default: `${pct}% de la valeur couverte` })}
      >
        <div
          className="h-full transition-[width] duration-700 ease-[var(--ease-curtain)]"
          style={{ width: `${pct}%`, background: "var(--color-or)" }}
        />
      </div>

      {missingCount > 0 ? (
        <>
          <p className="mt-5 text-sm text-[var(--color-ivoire-soft)]">
            {t("dossier.coverage.missing", {
              n: missingCount,
              default: `${missingCount} pièce(s) sans justificatif — les plus coûteuses d'abord :`,
            })}
          </p>
          <ul className="mt-3 space-y-1.5">
            {uncovered.map(({ item, amount }) => (
              <li key={item.id} className="flex items-baseline justify-between gap-3 text-sm">
                <Link
                  to={`/figures/${item.figure_id}`}
                  className="truncate text-[var(--color-ivoire)] hover:text-[var(--color-or-pale)] transition-colors"
                >
                  <Paperclip size={12} className="inline mr-1.5 opacity-60" aria-hidden />
                  {item.figure_name}
                </Link>
                <span className="tabular-nums shrink-0 text-[var(--color-ivoire-soft)]">
                  <Money amount={amount} currency={dc.display} />
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="mt-5 text-sm text-[var(--color-jade, var(--color-ivoire-soft))]">
          {t("dossier.coverage.complete", {
            default: "Chaque pièce valorisée porte son justificatif.",
          })}
        </p>
      )}
    </section>
  );
}

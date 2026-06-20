import Reveal from "../../components/motion/Reveal.jsx";
import { StatCard } from "../../components/ui/index.js";
import Money from "../../components/Money.jsx";

/**
 * Souhaits KPI strip — true wishlist metrics on the shared StatCard. Gold is
 * reserved for value (budget des cibles, sous la cible); counts stay neutral.
 * `budget` / `budgetConv` / `showBudgetConv` are pre-computed by the page so the
 * display-currency conversion mirrors the rest of the app.
 */
export default function WishlistKpiStrip({
  t,
  count,
  targeted,
  dealsMet,
  budget,
  budgetConv,
  showBudgetConv,
  displayCurrency,
}) {
  return (
    <Reveal as="div" y={16} className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <StatCard label={t("wishlist.count_label")} value={count} />
      <StatCard
        label={t("wishlist.budget_label")}
        value={
          budget ? (
            showBudgetConv ? (
              <Money amount={budgetConv.amount} currency={displayCurrency} approx round />
            ) : (
              <span>
                {budget.buckets.length > 1 ? "~ " : ""}
                <Money amount={budget.dominant.amount} currency={budget.dominant.currency} round />
              </span>
            )
          ) : (
            "—"
          )
        }
        sub={
          budget ? t("wishlist.kpi.targeted_sub", { n: targeted, default: "{n} ciblées" }) : null
        }
        tone="gold"
      />
      <StatCard
        label={t("wishlist.kpi.targeted", { default: "Avec cible" })}
        value={targeted}
        sub={t("wishlist.kpi.untargeted_sub", { n: count - targeted, default: "{n} sans cible" })}
      />
      <StatCard
        label={t("wishlist.kpi.deals", { default: "Sous la cible" })}
        value={dealsMet}
        tone="gold"
      />
    </Reveal>
  );
}

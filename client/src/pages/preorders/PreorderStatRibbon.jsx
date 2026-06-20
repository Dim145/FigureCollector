import Money from "../../components/Money.jsx";
import StatCard from "../../components/StatCard.jsx";
import Reveal from "../../components/motion/Reveal.jsx";

/**
 * The Horarium stat ribbon. Answers, at a glance, the page's two core
 * questions — "what's next?" and "how much have I committed?".
 *
 *   Total            · how many pieces are on the books
 *   Prochaine sortie  · the soonest countdown (amber = urgency)
 *   En transit        · parcels in motion (cyan)
 *   Acomptes versés   · deposits already paid (gold = value)
 *   Solde à régler    · balance still owed (red = money you still owe)
 *
 * Money is summed per ISO currency in deriveStats (never cross-converted at
 * the data layer); each currency renders as its own <Money> so the
 * DisplayCurrency layer can still convert for presentation. Composes the
 * shared StatCard — `tone` tints the number (gold/red/default).
 */

/** Render a { CCY: amount } map as stacked <Money> rows, or an em-dash when
 *  empty. Kept tiny so it slots into StatCard's numeric `value` position. */
function MoneyStack({ byCcy, zeroLabel }) {
  const entries = Object.entries(byCcy).filter(([, v]) => v > 0);
  if (entries.length === 0) {
    return <span className="text-[var(--color-ivoire-soft)]/45">{zeroLabel}</span>;
  }
  return (
    <span className="flex flex-col leading-tight">
      {entries.map(([ccy, amount]) => (
        <Money key={ccy} amount={amount} currency={ccy} round />
      ))}
    </span>
  );
}

export default function PreorderStatRibbon({ stats, t }) {
  return (
    <Reveal
      as="section"
      y={16}
      aria-label={t("preorders.title")}
      className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5"
    >
      <StatCard label={t("preorders.stat.total")} value={stats.total} tone="gold" />

      <StatCard
        label={t("preorders.stat.next")}
        value={stats.next ? stats.next.label : t("preorders.stat.next_none")}
        sub={stats.next ? stats.next.title : undefined}
      />

      <StatCard
        label={t("preorders.stat.in_transit")}
        value={stats.inTransit > 0 ? stats.inTransit : t("preorders.stat.in_transit_none")}
      />

      <StatCard
        label={t("preorders.stat.deposits", { default: "Acomptes versés" })}
        value={
          <MoneyStack
            byCcy={stats.depositsByCcy}
            zeroLabel={t("preorders.stat.deposits_none", { default: "—" })}
          />
        }
        tone="gold"
      />

      <StatCard
        label={t("preorders.stat.balance", { default: "Solde à régler" })}
        value={
          <MoneyStack
            byCcy={stats.balanceByCcy}
            zeroLabel={t("preorders.stat.balance_none", { default: "Rien à régler" })}
          />
        }
        tone="red"
      />
    </Reveal>
  );
}

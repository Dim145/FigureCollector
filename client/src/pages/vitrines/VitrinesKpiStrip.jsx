import Reveal from "../../components/motion/Reveal.jsx";
import { StatCard } from "../../components/ui/index.js";
import Money from "../../components/Money.jsx";

/**
 * Vitrines KPI strip — figurine metrics only (meubles · rangées · non rangées ·
 * valeur). Counts stay neutral; gold is reserved for the aggregate value, and
 * the "non rangées" count goes red when there's a backlog to shelve. Values are
 * derived from the live board upstream so they track drags optimistically.
 */
export default function VitrinesKpiStrip({ t, cabinets, shelved, loose, totalValue }) {
  return (
    <Reveal as="div" y={16} className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <StatCard
        label={t("nav.vitrines")}
        value={cabinets}
        sub={t("vitrines.stat.cabinets_sub", { default: "Meubles" })}
      />
      <StatCard label={t("vitrines.stat.shelved", { default: "Pièces rangées" })} value={shelved} />
      <StatCard
        label={t("vitrines.stat.loose", { default: "Non rangées" })}
        value={loose}
        tone={loose > 0 ? "red" : undefined}
      />
      <StatCard
        label={t("vitrines.stat.value", { default: "Valeur en vitrine" })}
        value={
          totalValue ? <Money amount={totalValue.amount} currency={totalValue.currency} /> : "—"
        }
        tone="gold"
      />
    </Reveal>
  );
}

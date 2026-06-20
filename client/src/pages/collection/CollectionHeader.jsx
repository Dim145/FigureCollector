import { Link } from "react-router-dom";
import StatCard from "../../components/StatCard.jsx";
import Money from "../../components/Money.jsx";
import { fmtMoney } from "../../lib/money.js";

/**
 * Collection sub-header: the KPI strip + the "lenses" (sibling views of the
 * same pieces) chip row. Pure presentation — every value + handler is owned by
 * CollectionPage. Lives directly under the PageLayout editorial header.
 *
 * Lenses are *links* to sibling pages (Vitrines, La Cote); the "À vendre"
 * toggle is the one in-page filter lens (hanko-red when engaged, since it
 * narrows the gallery). "Sélection multiple" is an action, set apart by a
 * hairline divider so it doesn't read as another view.
 */
export default function CollectionHeader({
  t,
  stats,
  saleCount,
  saleOnly,
  onToggleSale,
  selectMode,
  onToggleSelect,
  canSelect,
}) {
  return (
    <div className="reveal" style={{ "--i": 0 }}>
      {/* Lenses — sibling views + the one in-page sale filter. */}
      <nav className="flex flex-wrap items-center gap-2" aria-label={t("collection.lenses")}>
        <Link
          to="/collection/vitrines"
          className="chip hover:border-[var(--color-or)] hover:text-[var(--color-or)] transition-colors"
        >
          {t("nav.vitrines")}
        </Link>
        <Link
          to="/insights/cote"
          className="chip hover:border-[var(--color-or)] hover:text-[var(--color-or)] transition-colors"
        >
          {t("cote.title")}
        </Link>
        {saleCount > 0 ? (
          <button
            type="button"
            onClick={onToggleSale}
            aria-pressed={saleOnly}
            className={`chip inline-flex items-center gap-1.5 transition-colors ${
              saleOnly
                ? "!border-[var(--color-laque-bright)] !text-[var(--color-laque-bright)]"
                : "hover:border-[var(--color-laque-bright)] hover:text-[var(--color-laque-bright)]"
            }`}
          >
            {t("collection.lens.for_sale")}
            <span className="font-mono text-[10px] opacity-70">{saleCount}</span>
          </button>
        ) : null}
        {canSelect ? (
          <>
            <span
              aria-hidden
              className="self-center mx-1 w-px h-4 bg-[color-mix(in_oklab,var(--color-or)_25%,transparent)]"
            />
            <button
              type="button"
              onClick={onToggleSelect}
              aria-pressed={selectMode}
              className={`chip inline-flex items-center gap-1.5 transition-colors ${
                selectMode
                  ? "!border-[var(--color-or)] !text-[var(--color-or)]"
                  : "hover:border-[var(--color-or)] hover:text-[var(--color-or)]"
              }`}
            >
              <span aria-hidden>{selectMode ? "✓" : "☑"}</span>
              {selectMode ? t("bulk.done") : t("bulk.select")}
            </button>
          </>
        ) : null}
      </nav>

      {/* KPI strip — figurine metrics only. */}
      <div className="mt-6 grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label={t("collection.kpi.pieces")} value={stats.pieces} />
        <StatCard
          label={t("collection.kpi.value")}
          value={stats.value ? <Money amount={stats.value.sum} currency={stats.value.cur} /> : "—"}
          sub={
            stats.paid
              ? `${t("collection.kpi.paid")} · ${fmtMoney(stats.paid.sum, stats.paid.cur)}`
              : null
          }
          tone="gold"
        />
        <StatCard label={t("collection.kpi.preorders")} value={stats.preorders} tone="red" />
        <StatCard label={t("nav.vitrines")} value={stats.vitrines} />
      </div>
    </div>
  );
}

import { useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { Plus } from "lucide-react";
import { useI18n, useT } from "../i18n/index.jsx";
import { useDefaultCurrency, useMe } from "../hooks/useMe.js";
import { usePreorders } from "../hooks/useCollection.js";
import AppShell from "../components/AppShell.jsx";
import Button from "../components/Button.jsx";
import EmptyState from "../components/EmptyState.jsx";
import ErrorState from "../components/ErrorState.jsx";
import { PageLayout } from "../components/layout/index.js";
import CalendarSubscribe from "./preorders/CalendarSubscribe.jsx";
import PreorderStatRibbon from "./preorders/PreorderStatRibbon.jsx";
import SlipRadar from "./preorders/SlipRadar.jsx";
import CashflowPlan from "./preorders/CashflowPlan.jsx";
import PreorderFilterRail from "./preorders/PreorderFilterRail.jsx";
import PreorderMonthGroup from "./preorders/PreorderMonthGroup.jsx";
import PreorderAddDialog from "./preorders/PreorderAddDialog.jsx";
import { deriveStats, groupByMonth } from "./preorders/preorderConstants.js";

/**
 * /preorders — the "Horarium", a hand-kept register of acquisitions to come.
 *
 * A chronological ledger threaded down a single gold spine: entries grouped by
 * release month, each stamped with a kanji lifecycle seal and a countdown.
 * Answers two questions at a glance — "what's next?" and "how much have I
 * committed?" (the finance cards in the stat ribbon). The page's one primary
 * CTA opens the add-preorder dialog.
 *
 * This file is a thin orchestrator: it owns the data hooks, the filter state,
 * the dialog state, and the derived stats/grouping, then composes the
 * page-local sub-components under ./preorders/. Imminent (≤14d) entries keep
 * their amber seal glow; the spine, markers and glow all degrade under
 * prefers-reduced-motion via the shared .horarium-* CSS.
 */
export default function PreordersPage() {
  const t = useT();
  const { locale } = useI18n();
  const me = useMe();
  const preferredCurrency = useDefaultCurrency();
  const preorders = usePreorders();
  const [filter, setFilter] = useState("all");
  const [addOpen, setAddOpen] = useState(false);

  // ALL hooks must run on every render — keep them above any early return so
  // the hook ordering stays stable when auth state changes.
  const all = useMemo(() => preorders.data ?? [], [preorders.data]);
  const sorted = useMemo(
    () =>
      [...all].sort((a, b) => {
        const ad = a.release_date_current ?? a.release_date_original ?? "9999-12-31";
        const bd = b.release_date_current ?? b.release_date_original ?? "9999-12-31";
        return ad.localeCompare(bd);
      }),
    [all],
  );
  const filtered = useMemo(
    () => (filter === "all" ? sorted : sorted.filter((p) => p.status === filter)),
    [sorted, filter],
  );
  const countByStatus = useMemo(() => {
    const m = { all: all.length };
    for (const p of all) m[p.status] = (m[p.status] ?? 0) + 1;
    return m;
  }, [all]);
  const stats = useMemo(() => deriveStats(sorted, t), [sorted, t]);
  const months = useMemo(() => groupByMonth(filtered, t), [filtered, t]);

  if (me.isLoading) return null;
  if (!me.data?.authenticated) return <Navigate to="/login" replace />;

  if (preorders.isError) {
    return (
      <AppShell>
        <PageLayout width="standard">
          <ErrorState error={preorders.error} onRetry={() => preorders.refetch()} />
        </PageLayout>
      </AppShell>
    );
  }

  const addButton = (
    <Button variant="primary" iconStart={<Plus size={16} />} onClick={() => setAddOpen(true)}>
      {t("preorders.add.cta", { default: "Ajouter une pré-commande" })}
    </Button>
  );

  return (
    <AppShell>
      <PageLayout
        kicker="PRÉ-COMMANDES · 予約 · HORARIUM"
        title={t("preorders.title")}
        kanji="予約"
        toolbar={addButton}
        width="standard"
        className="horarium"
      >
        {all.length > 0 ? (
          <div className="space-y-8">
            <CalendarSubscribe t={t} />
            <PreorderStatRibbon stats={stats} t={t} />
            <CashflowPlan preorders={preorders.data} t={t} locale={locale} />
            <SlipRadar t={t} />
            <PreorderFilterRail filter={filter} onChange={setFilter} counts={countByStatus} t={t} />
          </div>
        ) : null}

        {all.length === 0 ? (
          <EmptyState
            kanji="予約"
            eyebrow={t("preorders.subtitle")}
            title={t("preorders.empty")}
            body={t("preorders.empty.hint")}
          >
            {addButton}
          </EmptyState>
        ) : filtered.length === 0 ? (
          <EmptyState
            kanji="予約"
            title={t("preorders.empty")}
            body={t("preorders.empty.filtered", {
              default: "Aucune pré-commande pour ce filtre.",
            })}
          >
            <Button variant="ghost" onClick={() => setFilter("all")}>
              {t("preorders.filter.all")}
            </Button>
          </EmptyState>
        ) : (
          <div className="horarium-timeline mt-10">
            {months.map((m) => (
              <PreorderMonthGroup key={m.key} month={m} t={t} />
            ))}
          </div>
        )}
      </PageLayout>

      <PreorderAddDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        defaultCurrency={preferredCurrency}
        t={t}
      />
    </AppShell>
  );
}

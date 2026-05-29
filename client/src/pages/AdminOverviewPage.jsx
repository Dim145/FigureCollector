import { useT } from "../i18n/index.jsx";
import { useAdminOverview } from "../hooks/useAdmin.js";
import Card from "../components/Card.jsx";

export default function AdminOverviewPage() {
  const t = useT();
  const overview = useAdminOverview();

  if (overview.isLoading) {
    return <p role="status" aria-live="polite" className="text-center text-[var(--color-ivoire-soft)]">…</p>;
  }
  if (overview.error || !overview.data) {
    return (
      <p className="text-center text-[var(--color-laque-bright)]">
        {overview.error?.message ?? t("error.unknown")}
      </p>
    );
  }
  const o = overview.data;
  const cards = [
    { label: t("admin.kpi.users"), value: o.user_count, sub: t("admin.kpi.admins", { n: o.admin_count }) },
    { label: t("admin.kpi.figures"), value: o.figure_count },
    { label: t("admin.kpi.owned"), value: o.owned_item_count },
    { label: t("admin.kpi.preorders"), value: o.preorder_count },
    { label: t("admin.kpi.photos"), value: o.photo_count },
    { label: t("admin.kpi.scans"), value: o.scan_count },
  ];

  return (
    <div>
      <p className="micro mb-6">{t("admin.overview.subtitle")}</p>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-5">
        {cards.map((c) => (
          <Card key={c.label} className="p-6">
            <p className="display text-4xl text-[var(--color-or)] leading-none">
              {Number(c.value).toLocaleString()}
            </p>
            <p className="micro mt-3">{c.label}</p>
            {c.sub ? <p className="text-[10px] mt-1 text-[var(--color-or-pale)]/80">{c.sub}</p> : null}
          </Card>
        ))}
      </div>
    </div>
  );
}

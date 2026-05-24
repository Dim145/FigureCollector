import { Navigate, useParams } from "react-router-dom";
import { useT } from "../i18n/index.jsx";
import { useMe } from "../hooks/useMe.js";
import { useCompare } from "../hooks/useProfile.js";
import AppShell from "../components/AppShell.jsx";
import Card from "../components/Card.jsx";
import FigureCard from "../components/FigureCard.jsx";

export default function ComparePage() {
  const { slug } = useParams();
  const t = useT();
  const me = useMe();
  const compare = useCompare(slug);

  if (me.isLoading) return null;
  if (!me.data?.authenticated) return <Navigate to="/login" replace />;
  if (compare.isLoading) return <AppShell><div className="text-center py-12 text-[var(--color-ivoire-soft)]">…</div></AppShell>;
  if (compare.error || !compare.data) {
    return (
      <AppShell>
        <main className="max-w-md mx-auto px-6 py-16 text-center">
          <p className="display text-2xl text-[var(--color-ivoire)]">404</p>
          <p className="mt-2 text-[var(--color-ivoire-soft)]">{t("error.unknown")}</p>
        </main>
      </AppShell>
    );
  }

  const { them, common, yours_only, theirs_only } = compare.data;

  return (
    <AppShell>
      <main className="max-w-6xl mx-auto px-6 py-12">
        <header className="text-center mb-12">
          <p className="micro">@{them.username}</p>
          <h1 className="display text-5xl mt-2 text-[var(--color-ivoire)]">
            {t("compare.title", { name: them.display_name })}
          </h1>
          <div className="gold-rule mx-auto w-32 mt-6" />
        </header>

        <div className="grid lg:grid-cols-3 gap-6">
          <Bucket title={t("compare.bucket.common")} count={common.length} entries={common} accent="or" />
          <Bucket title={t("compare.bucket.yours_only")} count={yours_only.length} entries={yours_only} accent="ivoire" />
          <Bucket title={t("compare.bucket.theirs_only")} count={theirs_only.length} entries={theirs_only} accent="laque" />
        </div>
      </main>
    </AppShell>
  );
}

function Bucket({ title, count, entries, accent }) {
  const accentColor =
    accent === "or"
      ? "var(--color-or)"
      : accent === "laque"
        ? "var(--color-laque-bright)"
        : "var(--color-ivoire)";
  return (
    <section>
      <header className="flex items-baseline justify-between mb-4">
        <h2
          className="display text-2xl"
          style={{ color: accentColor }}
        >
          {title}
        </h2>
        <span className="font-mono text-sm text-[var(--color-ivoire-soft)]">{count}</span>
      </header>
      <div className="gold-rule mb-4" />
      {entries.length === 0 ? (
        <Card className="p-6 text-center text-[var(--color-ivoire-soft)]">—</Card>
      ) : (
        <ul className="space-y-4">
          {entries.map((e) => (
            <li key={e.figure_id}>
              <FigureCard
                figureId={e.figure_id}
                href={`/figures/${e.figure_id}`}
                name={e.figure_name}
                type={e.figure_type}
                manufacturer={e.manufacturer_name}
                imageUrl={e.figure_image}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

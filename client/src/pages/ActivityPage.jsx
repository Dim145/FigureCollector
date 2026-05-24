import { Navigate } from "react-router-dom";
import { useT } from "../i18n/index.jsx";
import { useMe } from "../hooks/useMe.js";
import { useActivity } from "../hooks/useActivity.js";
import AppShell from "../components/AppShell.jsx";
import Card from "../components/Card.jsx";
import { formatEvent } from "../components/ActivityStrip.jsx";

export default function ActivityPage() {
  const t = useT();
  const me = useMe();
  const activity = useActivity({ limit: 100 });

  if (me.isLoading) return null;
  if (!me.data?.authenticated) return <Navigate to="/login" replace />;

  return (
    <AppShell>
      <main className="max-w-3xl mx-auto px-6 py-12">
        <header className="text-center mb-10">
          <p className="micro">{t("activity.subtitle")}</p>
          <h1 className="display text-5xl mt-2 text-[var(--color-ivoire)]">
            {t("activity.title")}
          </h1>
          <div className="gold-rule mx-auto w-32 mt-6" />
        </header>

        {activity.data?.length === 0 ? (
          <Card className="max-w-lg mx-auto p-8 text-center">
            <p className="text-[var(--color-ivoire-soft)]">{t("activity.empty")}</p>
          </Card>
        ) : (
          <ol className="relative pl-6 border-l border-[var(--color-or)]/25">
            {activity.data?.map((ev) => (
              <li key={ev.id} className="relative pb-6 last:pb-0">
                <span
                  aria-hidden
                  className="absolute -left-[7px] top-1.5 w-3 h-3 bg-[var(--color-noir)] border border-[var(--color-or)] rotate-45"
                />
                <p className="text-sm text-[var(--color-ivoire)] leading-snug">
                  {formatEvent(ev, t)}
                </p>
                <p className="micro mt-1">
                  {new Date(ev.created_at).toLocaleString()}
                </p>
              </li>
            ))}
          </ol>
        )}
      </main>
    </AppShell>
  );
}

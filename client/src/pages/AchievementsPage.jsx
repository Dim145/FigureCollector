import { useMemo } from "react";
import { Navigate } from "react-router-dom";
import { useT } from "../i18n/index.jsx";
import { useMe } from "../hooks/useMe.js";
import {
  useAchievementsCatalog,
  useMyAchievements,
} from "../hooks/useAchievements.js";
import AppShell from "../components/AppShell.jsx";
import Card from "../components/Card.jsx";

/**
 * Direction-B sceaux page: every catalog seal as a stamp tile, gold-leafed
 * when unlocked, washed out and locked when not. Grouped by category, sorted
 * by sort_order. Hover/focus shows the threshold + (when unlocked) the date.
 */
export default function AchievementsPage() {
  const t = useT();
  const me = useMe();
  const catalog = useAchievementsCatalog();
  const mine = useMyAchievements();

  const grouped = useMemo(() => {
    if (!catalog.data) return {};
    const unlocked = new Map(
      (mine.data ?? []).map((a) => [a.code, a.unlocked_at]),
    );
    const by = {};
    [...catalog.data]
      .sort((a, b) => a.sort_order - b.sort_order)
      .forEach((a) => {
        by[a.category] ??= [];
        by[a.category].push({ ...a, unlocked_at: unlocked.get(a.code) ?? null });
      });
    return by;
  }, [catalog.data, mine.data]);

  if (me.isLoading) return null;
  if (!me.data?.authenticated) return <Navigate to="/login" replace />;

  const unlockedCount = mine.data?.length ?? 0;
  const totalCount = catalog.data?.length ?? 0;

  return (
    <AppShell>
      <main className="max-w-5xl mx-auto px-6 py-12">
        <header className="text-center mb-12 relative">
          <p className="micro">{t("achievements.subtitle")}</p>
          <h1 className="display text-5xl mt-2 text-[var(--color-ivoire)]">
            {t("achievements.title")}
          </h1>
          <div className="gold-rule mx-auto w-32 mt-6" />
          <p className="mt-6 micro">
            {t("achievements.progress", { unlocked: unlockedCount, total: totalCount })}
          </p>
        </header>

        {Object.keys(grouped).length === 0 ? (
          <Card className="p-10 text-center">
            <p className="text-[var(--color-ivoire-soft)]">{t("achievements.empty")}</p>
          </Card>
        ) : (
          <div className="space-y-12">
            {Object.entries(grouped).map(([category, items]) => (
              <section key={category}>
                <h2 className="micro mb-5">
                  {t(`achievements.category.${category}`)} · {items.filter((i) => i.unlocked_at).length}/{items.length}
                </h2>
                <ul className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                  {items.map((a) => (
                    <Seal key={a.code} a={a} t={t} />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </main>
    </AppShell>
  );
}

function Seal({ a, t }) {
  const locked = !a.unlocked_at;
  const tier = a.tier;
  const ringColour =
    tier === "gold"
      ? "var(--color-or)"
      : tier === "silver"
        ? "var(--color-or-pale)"
        : "var(--color-or)/60";
  return (
    <li className="relative group">
      <div
        className={`aspect-square relative grid place-items-center border-2 transition-all ${
          locked
            ? "border-[var(--color-or)]/15 bg-[var(--color-noir)]"
            : "border-[var(--color-or)] bg-[var(--color-noir-soft)]"
        }`}
        style={{
          boxShadow: locked
            ? undefined
            : "0 20px 40px -20px rgba(0,0,0,0.7), inset 0 0 0 1px oklch(0.78 0.10 80 / 0.18)",
        }}
      >
        {/* Inner stamp ring */}
        <div
          aria-hidden
          className={`absolute inset-3 border rounded-full transition-all ${
            locked ? "border-[var(--color-or)]/10" : "border-dashed"
          }`}
          style={{ borderColor: ringColour }}
        />
        <div className="text-center">
          <p
            className={`ja text-3xl ${
              locked
                ? "text-[var(--color-or)]/15"
                : tier === "gold"
                  ? "text-[var(--color-or)]"
                  : tier === "silver"
                    ? "text-[var(--color-or-pale)]"
                    : "text-[var(--color-or)]/70"
            }`}
          >
            {tierKanji(tier)}
          </p>
          <p
            className={`mt-2 micro ${locked ? "text-[var(--color-ivoire-soft)]/40" : "text-[var(--color-or-pale)]"}`}
          >
            {a.threshold}
          </p>
        </div>
      </div>

      <p
        className={`mt-2 text-center text-xs tracking-wide leading-tight ${
          locked
            ? "text-[var(--color-ivoire-soft)]/60"
            : "text-[var(--color-ivoire)]"
        }`}
      >
        {t(`achievements.label.${a.code}`, {
          default: a.code,
          threshold: a.threshold,
        })}
      </p>

      {!locked ? (
        <p className="text-center text-[10px] mt-0.5 text-[var(--color-or)]/70 font-mono">
          {new Date(a.unlocked_at).toLocaleDateString()}
        </p>
      ) : null}
    </li>
  );
}

function tierKanji(tier) {
  switch (tier) {
    case "gold":
      return "金";
    case "silver":
      return "銀";
    default:
      return "銅";
  }
}

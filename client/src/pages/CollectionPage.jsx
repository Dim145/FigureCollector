import { useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useT } from "../i18n/index.jsx";
import { useMe } from "../hooks/useMe.js";
import { useOwnedItems, useRemoveOwnedItem } from "../hooks/useCollection.js";
import AppShell from "../components/AppShell.jsx";
import Button from "../components/Button.jsx";
import Card from "../components/Card.jsx";
import CountUp from "../components/CountUp.jsx";
import FigureCard from "../components/FigureCard.jsx";
import { resolveOwnedCover } from "../lib/coverUrl.js";
import { preorderBadgeLabel, preorderPhase } from "../lib/preorderStatus.js";

const CONDITION_FILTERS = [
  "all", "mib_sealed", "opened_box", "displayed", "loose", "damaged",
];

/**
 * Personal gallery view.
 *  - Hero with kanji backdrop + inline counters (pieces, manufacturers, types)
 *  - Condition filter chip bar
 *  - Stagger-reveal grid with the redesigned FigureCard
 */
export default function CollectionPage() {
  const t = useT();
  const me = useMe();
  const owned = useOwnedItems();
  const remove = useRemoveOwnedItem();
  const [conditionFilter, setConditionFilter] = useState("all");

  const stats = useMemo(() => {
    const data = owned.data ?? [];
    const manufacturers = new Set(
      data.map((o) => o.manufacturer_name).filter(Boolean),
    );
    const types = new Set(data.map((o) => o.figure_type));
    return {
      pieces: data.length,
      manufacturers: manufacturers.size,
      types: types.size,
    };
  }, [owned.data]);

  const filtered = useMemo(() => {
    if (!owned.data) return [];
    if (conditionFilter === "all") return owned.data;
    return owned.data.filter((o) => o.condition === conditionFilter);
  }, [owned.data, conditionFilter]);

  if (me.isLoading) return null;
  if (!me.data?.authenticated) return <Navigate to="/login" replace />;

  return (
    <AppShell>
      <main className="relative max-w-7xl mx-auto px-6 py-16">
        {/* ─── Hero ─── */}
        <header className="relative mb-12">
          <span
            aria-hidden
            className="kanji-mark text-[26rem] -top-32 -right-10 hidden md:block"
          >
            蒐
          </span>

          <p className="micro reveal" style={{ "--i": 0 }}>
            {t("collection.subtitle")}
          </p>
          <h1
            className="display text-6xl md:text-7xl mt-3 text-[var(--color-ivoire)] leading-[0.95] reveal"
            style={{ "--i": 1 }}
          >
            {t("collection.title")}
          </h1>
          <div className="gold-rule w-32 mt-6 reveal" style={{ "--i": 2 }} />

          {owned.data?.length ? (
            <dl
              className="mt-8 flex flex-wrap items-baseline gap-x-10 gap-y-3 reveal"
              style={{ "--i": 3 }}
            >
              <Counter label={t("collection.kpi.pieces")} value={stats.pieces} />
              <Counter
                label={t("collection.kpi.manufacturers")}
                value={stats.manufacturers}
              />
              <Counter label={t("collection.kpi.types")} value={stats.types} />
            </dl>
          ) : null}
        </header>

        {/* ─── Empty / loading / grid ─── */}
        {owned.isLoading ? (
          <p className="text-center text-[var(--color-ivoire-soft)] py-12">…</p>
        ) : owned.data?.length === 0 ? (
          <EmptyState t={t} />
        ) : (
          <>
            <nav
              aria-label="filter by condition"
              className="flex flex-wrap items-center gap-2 mb-8 reveal"
              style={{ "--i": 4 }}
            >
              {CONDITION_FILTERS.map((c) => {
                const active = conditionFilter === c;
                const count =
                  c === "all"
                    ? owned.data.length
                    : owned.data.filter((o) => o.condition === c).length;
                if (c !== "all" && count === 0) return null;
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setConditionFilter(c)}
                    className={`px-3 py-1.5 text-[10px] uppercase tracking-[0.22em] border transition-colors ${
                      active
                        ? "border-[var(--color-or)] bg-[var(--color-or)]/10 text-[var(--color-or)]"
                        : "border-[var(--color-or)]/20 text-[var(--color-ivoire-soft)] hover:text-[var(--color-or-pale)] hover:border-[var(--color-or)]/50"
                    }`}
                  >
                    {c === "all" ? t("collection.filter.all") : t(`condition.${c}`)}
                    <span
                      className={`ml-2 font-mono normal-case tracking-wider text-[9px] ${
                        active
                          ? "text-[var(--color-or)]"
                          : "text-[var(--color-or-pale)]/70"
                      }`}
                    >
                      {count}
                    </span>
                  </button>
                );
              })}
            </nav>

            <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {filtered.map((item, i) => (
                <li
                  key={item.id}
                  className="reveal"
                  style={{ "--i": Math.min(i, 10) + 5 }}
                >
                  <FigureCard
                    figureId={item.figure_id}
                    href={`/figures/${item.figure_id}`}
                    name={item.figure_name}
                    type={item.figure_type}
                    manufacturer={item.manufacturer_name}
                    imageUrl={resolveOwnedCover(item)}
                    scale={item.scale}
                    heightMm={item.height_mm}
                    blurImage={
                      item.is_nsfw &&
                      (me.data?.user?.nsfw_visibility ?? "hide") === "blur"
                    }
                    badge={(() => {
                      // Pre-order phase wins — it's the more time-sensitive
                      // signal. Cover-pinned badge falls back when there's
                      // no lifecycle event to surface.
                      const phase = preorderPhase(item);
                      const label = preorderBadgeLabel(phase, t);
                      if (label) {
                        return {
                          label,
                          tone: phase === "imminent" ? "imminent" : "preorder",
                        };
                      }
                      if (item.cover_photo_id || item.cover_scan_id) {
                        return t("collection.cover.pinned");
                      }
                      return null;
                    })()}
                  />
                  <div className="mt-3 flex items-center justify-between gap-3 px-1">
                    <span className="micro-tight">
                      {t(`condition.${item.condition}`)}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        if (confirm(t("collection.remove") + " ?")) {
                          remove.mutate(item.id);
                        }
                      }}
                      disabled={remove.isPending}
                      className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-ivoire-soft)] hover:text-[var(--color-laque-bright)] transition-colors disabled:opacity-50"
                    >
                      {t("collection.remove")}
                    </button>
                  </div>
                </li>
              ))}
            </ul>

            {filtered.length === 0 ? (
              <p className="text-center text-[var(--color-ivoire-soft)] italic mt-12">
                {t("collection.filter.empty")}
              </p>
            ) : null}
          </>
        )}
      </main>
    </AppShell>
  );
}

function Counter({ label, value }) {
  return (
    <div>
      <dt className="label-mono">{label}</dt>
      <dd className="figural-xl text-6xl text-[var(--color-or)] mt-1">
        <CountUp value={value} />
      </dd>
    </div>
  );
}

function EmptyState({ t }) {
  return (
    <Card className="max-w-xl mx-auto p-12 text-center relative overflow-hidden frame-corners">
      <span
        aria-hidden
        className="ja absolute -top-6 -right-6 text-[14rem] text-[var(--color-or)]/10 leading-none select-none"
      >
        空
      </span>
      <p className="micro relative">{t("collection.empty.eyebrow")}</p>
      <h2 className="display text-3xl mt-3 text-[var(--color-ivoire)] relative">
        {t("collection.empty.title")}
      </h2>
      <p className="mt-4 text-[var(--color-ivoire-soft)] leading-relaxed relative">
        {t("collection.empty.body")}
      </p>
      <div className="gold-rule mx-auto w-20 my-8" />
      <div className="flex flex-wrap gap-3 justify-center relative">
        <Link to="/browse">
          <Button variant="primary">{t("collection.empty.cta_browse")}</Button>
        </Link>
        <Link to="/figures/new">
          <Button variant="ghost">{t("collection.empty.cta")}</Button>
        </Link>
      </div>
    </Card>
  );
}

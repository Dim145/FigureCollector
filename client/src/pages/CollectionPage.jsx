import { useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useT } from "../i18n/index.jsx";
import { useMe } from "../hooks/useMe.js";
import { useOwnedItems, useRemoveOwnedItem } from "../hooks/useCollection.js";
import AppShell from "../components/AppShell.jsx";
import Button from "../components/Button.jsx";
import Card from "../components/Card.jsx";
import ConfirmDialog from "../components/ConfirmDialog.jsx";
import CountUp from "../components/CountUp.jsx";
import FigureCard from "../components/FigureCard.jsx";
import { resolveOwnedCover } from "../lib/coverUrl.js";
import { preorderBadgeLabel, preorderPhase } from "../lib/preorderStatus.js";

const CONDITION_FILTERS = [
  "all", "mib_sealed", "opened_box", "displayed", "loose", "damaged",
];

/** One kanji per condition, picked for resonance: 全 (all), 封 (sealed),
 *  開 (opened), 飾 (displayed), 裸 (loose / bare), 痍 (damaged). */
const CONDITION_KANJI = {
  all: "全",
  mib_sealed: "封",
  opened_box: "開",
  displayed: "飾",
  loose: "裸",
  damaged: "痍",
};

/**
 * Personal gallery — your collected pieces, with rotating KPI counters,
 * a kanji-tile condition filter, and the redesigned FigureCard.
 *
 * Pairs intentionally with `/browse`:
 *   - Same artifact badges on cards (brass plaque + status stamp)
 *   - Same kanji-tile filter rail (different vocabulary)
 *   - Different hero accent kanji: 蒐 (gather) vs 目 (eye)
 */
export default function CollectionPage() {
  const t = useT();
  const me = useMe();
  const owned = useOwnedItems();
  const remove = useRemoveOwnedItem();
  const [conditionFilter, setConditionFilter] = useState("all");
  // Owned-item id queued for deletion confirmation; null when the dialog
  // is closed. Drives a styled ConfirmDialog rather than the unstylable
  // native `window.confirm()` we used to call.
  const [pendingRemove, setPendingRemove] = useState(null);

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

  const countsByCondition = useMemo(() => {
    const m = new Map();
    for (const o of owned.data ?? []) {
      m.set(o.condition, (m.get(o.condition) ?? 0) + 1);
    }
    return m;
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
            {/* Condition kanji-tile rail */}
            <nav
              aria-label="filter by condition"
              className="tile-rail mb-8 reveal"
              style={{ "--i": 4 }}
            >
              {CONDITION_FILTERS.map((c) => {
                const active = conditionFilter === c;
                const count =
                  c === "all"
                    ? owned.data.length
                    : countsByCondition.get(c) ?? 0;
                if (c !== "all" && count === 0) return null;
                return (
                  <button
                    key={c}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setConditionFilter(c)}
                    className={`tile ${active ? "is-active" : ""}`}
                  >
                    <span className="tile-count" aria-hidden>
                      {count}
                    </span>
                    <span className="tile-kanji" aria-hidden>
                      {CONDITION_KANJI[c] ?? "・"}
                    </span>
                    <span className="tile-romaji">
                      {c === "all"
                        ? t("collection.filter.all")
                        : t(`condition.${c}`)}
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
                    versionName={item.version_name}
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
                        return {
                          label: t("collection.cover.pinned"),
                          tone: "neutral",
                        };
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
                      onClick={() => setPendingRemove(item)}
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
      <ConfirmDialog
        open={!!pendingRemove}
        title={t("collection.remove")}
        body={
          pendingRemove
            ? t("collection.remove.body", {
                name: pendingRemove.figure_name ?? "",
                default: t("collection.remove") + " ?",
              })
            : null
        }
        destructive
        busy={remove.isPending}
        onCancel={() => setPendingRemove(null)}
        onConfirm={() => {
          if (pendingRemove) {
            remove.mutate(pendingRemove.id, {
              onSuccess: () => setPendingRemove(null),
              onError: () => setPendingRemove(null),
            });
          }
        }}
      />
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

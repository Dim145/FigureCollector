import { useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useT } from "../i18n/index.jsx";
import { useMe } from "../hooks/useMe.js";
import {
  useOwnedItems,
  useRemoveOwnedItem,
  useUpdateOwnedItem,
  useArchiveOwnedItem,
  useLocations,
} from "../hooks/useCollection.js";
import { useRowSelection } from "../hooks/useRowSelection.js";
import AccentTitle from "../components/AccentTitle.jsx";
import AppShell from "../components/AppShell.jsx";
import Button from "../components/Button.jsx";
import Card from "../components/Card.jsx";
import ConfirmDialog from "../components/ConfirmDialog.jsx";
import StatCard from "../components/StatCard.jsx";
import FigureCard from "../components/FigureCard.jsx";
import Reveal from "../components/motion/Reveal.jsx";
import { resolveOwnedCover } from "../lib/coverUrl.js";
import { preorderBadgeLabel, preorderPhase } from "../lib/preorderStatus.js";
import { effectiveValue, paidTotal, fmtMoney } from "../lib/money.js";

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
  // `showArchived` toggles the optional "Voir aussi annulées" pass that
  // surfaces preorder cancellations with a partial / no refund. Hidden by
  // default so the active collection stays the focus.
  const [showArchived, setShowArchived] = useState(false);
  const owned = useOwnedItems({ includeArchived: showArchived });
  const remove = useRemoveOwnedItem();
  const update = useUpdateOwnedItem();
  const archive = useArchiveOwnedItem();
  const locations = useLocations();
  const [conditionFilter, setConditionFilter] = useState("all");
  // Bulk-edit mode: turn the grid into a multi-select surface with a sticky
  // action bar (set vitrine / condition, archive, delete).
  const [selectMode, setSelectMode] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [pendingBulkDelete, setPendingBulkDelete] = useState(false);
  // Owned-item id queued for deletion confirmation; null when the dialog
  // is closed. Drives a styled ConfirmDialog rather than the unstylable
  // native `window.confirm()` we used to call.
  const [pendingRemove, setPendingRemove] = useState(null);
  const archivedCount = useMemo(
    () => (owned.data ?? []).filter((o) => o.archived_at).length,
    [owned.data],
  );

  const stats = useMemo(() => {
    const data = owned.data ?? [];
    const manufacturers = new Set(
      data.map((o) => o.manufacturer_name).filter(Boolean),
    );
    const types = new Set(data.map((o) => o.figure_type));
    const vitrines = new Set(data.map((o) => o.location).filter(Boolean));
    const preorders = data.filter((o) => {
      const ph = preorderPhase(o);
      return ph === "preorder" || ph === "imminent";
    }).length;
    // No FX layer: aggregate per currency, then surface the dominant-currency
    // total — the same convention as La Cote (glanceable; the Cote page has the
    // full per-currency breakdown).
    const dominant = (pick) => {
      const byCur = new Map();
      for (const it of data) {
        const v = pick(it);
        if (!v || v.amount == null) continue;
        const cur = (v.currency || "EUR").toUpperCase();
        byCur.set(cur, (byCur.get(cur) || 0) + Number(v.amount));
      }
      let best = null;
      for (const [cur, sum] of byCur) {
        if (!best || sum > best.sum) best = { cur, sum };
      }
      return best;
    };
    return {
      pieces: data.length,
      manufacturers: manufacturers.size,
      types: types.size,
      vitrines: vitrines.size,
      preorders,
      value: dominant(effectiveValue),
      paid: dominant(paidTotal),
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

  const ids = useMemo(() => filtered.map((o) => o.id), [filtered]);
  const sel = useRowSelection(ids);

  if (me.isLoading) return null;
  if (!me.data?.authenticated) return <Navigate to="/login" replace />;

  // ── Bulk actions over the current selection ──────────────────────────────
  const selectedItems = filtered.filter((o) => sel.isSelected(o.id));
  const exitSelect = () => {
    sel.clear();
    setSelectMode(false);
  };
  // Run a per-item mutation across the selection, then drop the selection.
  const runBulk = async (fn) => {
    if (bulkBusy || selectedItems.length === 0) return;
    setBulkBusy(true);
    try {
      for (const item of selectedItems) {
        // Sequential, not Promise.all: keeps the request count gentle and the
        // ["owned"] invalidation from thundering on every settled mutation.
        await fn(item);
      }
    } finally {
      setBulkBusy(false);
      exitSelect();
    }
  };
  const bulkSetLocation = (location) =>
    runBulk((item) => update.mutateAsync({ id: item.id, patch: { location } }));
  const bulkSetCondition = (condition) =>
    runBulk((item) => update.mutateAsync({ id: item.id, patch: { condition } }));
  const bulkArchive = () => runBulk((item) => archive.mutateAsync(item.id));
  const bulkDelete = () => {
    setPendingBulkDelete(false);
    runBulk((item) => remove.mutateAsync(item.id));
  };
  const locationOptions = [
    { value: "", label: t("bulk.unshelve") },
    ...(locations.data ?? []).map((l) => ({ value: l.name, label: l.name })),
  ];

  return (
    <AppShell>
      <main className="relative max-w-7xl mx-auto px-6 py-16">
        {/* Hero colour-wash — jade-leaning (the "gathered" gallery) over the
            global aurora. Theme-aware via the accent vars. */}
        <div
          aria-hidden
          className="pointer-events-none absolute -top-24 left-0 right-0 h-[420px] -z-0"
          style={{
            background:
              "radial-gradient(48% 65% at 16% 0%, color-mix(in oklab, var(--color-jade) 18%, transparent), transparent 70%), radial-gradient(46% 60% at 88% 8%, color-mix(in oklab, var(--color-or) 20%, transparent), transparent 72%), radial-gradient(40% 55% at 60% 30%, color-mix(in oklab, var(--color-neon-magenta) 9%, transparent), transparent 75%)",
            // Feather the edges so the gradient fades instead of hard-cutting
            // at the content column (the vertical seam).
            WebkitMaskImage:
              "linear-gradient(to right, transparent 0, #000 8%, #000 92%, transparent 100%)",
            maskImage:
              "linear-gradient(to right, transparent 0, #000 8%, #000 92%, transparent 100%)",
          }}
        />
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
            <AccentTitle text={t("collection.title")} />
          </h1>
          <div className="gold-rule w-32 mt-6 reveal" style={{ "--i": 2 }} />

          {/* Collection lenses — sibling views of the same pieces. */}
          <nav
            className="mt-6 flex flex-wrap gap-2 reveal"
            style={{ "--i": 3 }}
            aria-label={t("collection.lenses")}
          >
            <Link
              to="/vitrines"
              className="chip hover:border-[var(--color-or)] hover:text-[var(--color-or)] transition-colors"
            >
              {t("nav.vitrines")}
            </Link>
            <Link
              to="/cote"
              className="chip hover:border-[var(--color-or)] hover:text-[var(--color-or)] transition-colors"
            >
              {t("cote.title")}
            </Link>
            {owned.data?.length ? (
              <>
                {/* Action, not a lens — set it apart from Vitrines / La Cote so
                    it reads as "start editing several pieces at once". */}
                <span
                  aria-hidden
                  className="self-center mx-1 w-px h-4 bg-[color-mix(in_oklab,var(--color-or)_25%,transparent)]"
                />
                <button
                  type="button"
                  onClick={() => (selectMode ? exitSelect() : setSelectMode(true))}
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

          {owned.data?.length ? (
            <div
              className="mt-8 grid grid-cols-2 lg:grid-cols-4 gap-3 reveal"
              style={{ "--i": 3 }}
            >
              <StatCard label={t("collection.kpi.pieces")} value={stats.pieces} />
              <StatCard
                label={t("collection.kpi.value")}
                value={
                  stats.value
                    ? fmtMoney(stats.value.sum, stats.value.cur)
                    : "—"
                }
                sub={
                  stats.paid
                    ? `${t("collection.kpi.paid")} · ${fmtMoney(stats.paid.sum, stats.paid.cur)}`
                    : null
                }
                tone="gold"
              />
              <StatCard
                label={t("collection.kpi.preorders")}
                value={stats.preorders}
                tone="red"
              />
              <StatCard label={t("nav.vitrines")} value={stats.vitrines} />
            </div>
          ) : null}
        </header>

        {/* ─── Empty / loading / grid ─── */}
        {owned.isLoading ? (
          <p role="status" aria-live="polite" className="text-center text-[var(--color-ivoire-soft)] py-12">…</p>
        ) : owned.data?.length === 0 ? (
          <EmptyState t={t} />
        ) : (
          <>
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

            {/* Archived toggle — when the user has any cancelled-and-kept
             *  preorders, surface them on demand with a separate switch
             *  so the active collection stays uncluttered. */}
            {showArchived && archivedCount > 0 ? (
              <p
                className="mb-4 text-[10px] uppercase tracking-[0.22em] text-[var(--color-laque-bright)]"
              >
                {t("collection.archived_shown", { n: archivedCount })}
                <button
                  type="button"
                  onClick={() => setShowArchived(false)}
                  className="ml-2 underline decoration-dotted hover:no-underline"
                >
                  {t("collection.archived_hide")}
                </button>
              </p>
            ) : !showArchived ? (
              <p
                className="mb-4 text-[10px] uppercase tracking-[0.22em] text-[var(--color-ivoire-soft)]/60"
              >
                <button
                  type="button"
                  onClick={() => setShowArchived(true)}
                  className="underline decoration-dotted hover:no-underline hover:text-[var(--color-laque-bright)] transition-colors"
                >
                  {t("collection.archived_show")}
                </button>
              </p>
            ) : null}

            {selectMode ? (
              <div className="sticky top-2 z-30 mb-5 flex flex-wrap items-center gap-2 p-3 border border-[color-mix(in_oklab,var(--color-or)_28%,transparent)] bg-[color-mix(in_oklab,var(--color-or)_10%,transparent)] backdrop-blur-md">
                <span className="display text-xl text-[var(--color-or-pale)]">
                  <b className="text-[var(--color-ivoire)]">{sel.selectedIds.length}</b>{" "}
                  {t("bulk.selected_label")}
                </span>
                <button type="button" onClick={sel.toggleAll} className="bulk-act">
                  {sel.allSelected ? t("bulk.none") : t("bulk.all")}
                </button>
                <span className="flex-1" />
                <select
                  aria-label={t("bulk.set_vitrine")}
                  disabled={bulkBusy || !sel.someSelected}
                  value="__"
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v !== "__") bulkSetLocation(v);
                  }}
                  className="bulk-act bg-[var(--color-noir)] disabled:opacity-40"
                >
                  <option value="__" disabled>{t("bulk.set_vitrine")}</option>
                  {locationOptions.map((o) => (
                    <option key={o.value || "__none"} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <select
                  aria-label={t("bulk.set_condition")}
                  disabled={bulkBusy || !sel.someSelected}
                  value="__"
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v !== "__") bulkSetCondition(v);
                  }}
                  className="bulk-act bg-[var(--color-noir)] disabled:opacity-40"
                >
                  <option value="__" disabled>{t("bulk.set_condition")}</option>
                  {CONDITION_FILTERS.filter((c) => c !== "all").map((c) => (
                    <option key={c} value={c}>
                      {t(`condition.${c}`)}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={bulkBusy || !sel.someSelected}
                  onClick={bulkArchive}
                  className="bulk-act disabled:opacity-40"
                >
                  {t("bulk.archive")}
                </button>
                <button
                  type="button"
                  disabled={bulkBusy || !sel.someSelected}
                  onClick={() => setPendingBulkDelete(true)}
                  className="bulk-act-danger disabled:opacity-40"
                >
                  {t("bulk.delete")}
                </button>
                <button type="button" onClick={exitSelect} className="bulk-act" aria-label={t("bulk.done")}>
                  ✕
                </button>
              </div>
            ) : null}

            <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {filtered.map((item, i) => {
                const blur =
                  item.is_nsfw &&
                  (me.data?.user?.nsfw_visibility ?? "hide") === "blur";
                const selected = sel.isSelected(item.id);
                const card = (
                  <FigureCard
                    figureId={item.figure_id}
                    href={selectMode ? undefined : `/figures/${item.figure_id}`}
                    name={item.figure_name}
                    type={item.figure_type}
                    manufacturer={item.manufacturer_name}
                    imageUrl={resolveOwnedCover(item)}
                    scale={item.scale}
                    versionName={item.version_name}
                    blurImage={blur}
                    badge={ownedBadge(item, t)}
                  />
                );
                return (
                  <Reveal
                    as="li"
                    key={item.id}
                    delay={Math.min(i, 7) * 0.05}
                    y={24}
                  >
                    {selectMode ? (
                      <button
                        type="button"
                        onClick={() => sel.toggle(item.id)}
                        aria-pressed={selected}
                        className="relative block w-full text-left"
                      >
                        <span
                          aria-hidden
                          className={`absolute top-2 left-2 z-[6] w-6 h-6 grid place-items-center text-[12px] ${
                            selected
                              ? "bg-[var(--color-or)] border border-[var(--color-or)] text-[var(--color-noir)]"
                              : "bg-[color-mix(in_oklab,var(--color-noir-deep)_72%,transparent)] border border-[color-mix(in_oklab,var(--color-or)_45%,transparent)] text-transparent"
                          }`}
                        >
                          ✓
                        </span>
                        <span
                          className={`block ${selected ? "outline outline-2 outline-[var(--color-or)]" : ""}`}
                        >
                          {card}
                        </span>
                      </button>
                    ) : (
                      card
                    )}
                    <div className="mt-3 flex items-center justify-between gap-3 px-1">
                      <span className="micro-tight">
                        {t(`condition.${item.condition}`)}
                      </span>
                      {!selectMode ? (
                        <button
                          type="button"
                          onClick={() => setPendingRemove(item)}
                          disabled={remove.isPending}
                          className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-ivoire-soft)] hover:text-[var(--color-laque-bright)] transition-colors disabled:opacity-50"
                        >
                          {t("collection.remove")}
                        </button>
                      ) : null}
                    </div>
                  </Reveal>
                );
              })}
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
      <ConfirmDialog
        open={pendingBulkDelete}
        title={t("bulk.delete")}
        body={t("bulk.delete.body", {
          n: sel.selectedIds.length,
          default: t("bulk.delete") + " ?",
        })}
        destructive
        busy={bulkBusy}
        onCancel={() => setPendingBulkDelete(false)}
        onConfirm={bulkDelete}
      />
    </AppShell>
  );
}

/** Badge for an owned-item card: archived (cancelled-and-kept) wins, then the
 *  pre-order phase, then a pinned-cover marker. Extracted so both the normal
 *  and the bulk-select renders share it. */
function ownedBadge(item, t) {
  if (item.archived_at) {
    return { label: t("collection.archived_badge"), tone: "cancelled" };
  }
  const phase = preorderPhase(item);
  const label = preorderBadgeLabel(phase, t);
  if (label) {
    return { label, tone: phase === "imminent" ? "imminent" : "preorder" };
  }
  if (item.cover_photo_id || item.cover_scan_id) {
    return { label: t("collection.cover.pinned"), tone: "neutral" };
  }
  return null;
}

// StatCard lives in components/StatCard.jsx (shared with the Catalogue strip).

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

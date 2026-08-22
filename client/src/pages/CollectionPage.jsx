import { useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { Plus } from "lucide-react";
import { useT } from "../i18n/index.jsx";
import { useMe } from "../hooks/useMe.js";
import {
  useOwnedItems,
  useOwnedPhotoTags,
  useRemoveOwnedItem,
  useUpdateOwnedItem,
  useArchiveOwnedItem,
  useLocations,
} from "../hooks/useCollection.js";
import { useRowSelection } from "../hooks/useRowSelection.js";
import useUrlState, { asBool } from "../hooks/useUrlState.js";
import useScrollRestoration from "../hooks/useScrollRestoration.js";
import useGridDensity from "../hooks/useGridDensity.js";
import { useDisplayCurrency } from "../components/DisplayCurrencyProvider.jsx";
import { toDisplay } from "../lib/money.js";
import AppShell from "../components/AppShell.jsx";
import { PageLayout } from "../components/layout/index.js";
import { Button, EmptyState } from "../components/ui/index.js";
import { SectionSkeleton } from "../components/Skeleton.jsx";
import ErrorState from "../components/ErrorState.jsx";
import ConfirmDialog from "../components/ConfirmDialog.jsx";
import { preorderPhase } from "../lib/preorderStatus.js";
import { effectiveValue, figurePaid } from "../lib/money.js";
import CollectionHeader from "./collection/CollectionHeader.jsx";
import ConditionFilterRail from "./collection/ConditionFilterRail.jsx";
import TagFilterRail from "./collection/TagFilterRail.jsx";
import FeaturedPiece from "./collection/FeaturedPiece.jsx";
import CollectionGrid from "./collection/CollectionGrid.jsx";
import CollectionToolbar from "./collection/CollectionToolbar.jsx";
import RecommendedShelf from "./collection/RecommendedShelf.jsx";

/**
 * Personal gallery — the collector's owned pieces. Thin orchestrator: it owns
 * the data hooks, the view state (filters, pin, select mode), and the
 * mutations, and composes the page-local sub-components on the shared
 * foundation (PageLayout editorial frame).
 *
 *   CollectionHeader     — KPI strip + lens chips (Vitrines / La Cote / sale)
 *   FeaturedPiece        — the optional "à la une" spread
 *   ConditionFilterRail  — kanji-faced condition tiles + the "annulées" facet
 *   CollectionGrid       — cards, per-card actions, select mode + bulk bar
 *   RecommendedShelf     — DINOv2 "recommandé pour toi" suggestions
 *
 * Pairs intentionally with /catalogue (same artifact cards + kanji rail);
 * hero accent kanji 蒐 (gather) vs the catalogue's 目 (eye).
 */
/**
 * The collection's view state lives in the URL, so a filtered shelf is
 * shareable and — crucially — survives the scroll → open a piece → back loop
 * that the page is built around. Values equal to their default drop out of the
 * query string, keeping an untouched /collection clean.
 */
const VIEW_DEFS = {
  q: { default: "" },
  sort: { default: "recent" },
  condition: { default: "all" },
  tag: { default: null, parse: (v) => v, serialize: (v) => v ?? "" },
  sale: { default: false, ...asBool },
  archived: { default: false, ...asBool },
};

/** Pieces revealed per page — the plate grows on demand rather than paying to
 *  lay out 300 cards no one has scrolled to yet. */
const PAGE = 48;

export default function CollectionPage() {
  const t = useT();
  const me = useMe();
  // `showArchived` surfaces the optional "annulées" pass (preorder
  // cancellations kept with a partial / no refund). Off by default so the
  // active collection stays the focus; promoted into the filter rail as a facet.
  const [view, setView] = useUrlState(VIEW_DEFS);
  const { q, sort } = view;
  const showArchived = view.archived;
  const setShowArchived = (v) =>
    setView({ archived: typeof v === "function" ? v(showArchived) : v });
  const owned = useOwnedItems({ includeArchived: showArchived });
  // Appearance-tag facet (WD-Tagger on the user's own photos). The chip list is
  // built from the unfiltered facets; selecting one narrows the grid via a
  // server-side `?tag=` fetch (tags live on photos, not on the owned row, so the
  // filtering can't be done client-side from `owned.data`).
  const tagFilter = view.tag;
  const setTagFilter = (v) => setView({ tag: v });
  const photoTags = useOwnedPhotoTags();
  const tagged = useOwnedItems({
    includeArchived: showArchived,
    tag: tagFilter,
    enabled: !!tagFilter,
  });
  const remove = useRemoveOwnedItem();
  const update = useUpdateOwnedItem();
  const archive = useArchiveOwnedItem();
  const locations = useLocations();
  const conditionFilter = view.condition;
  const setConditionFilter = (v) => setView({ condition: v });
  // Optional "à vendre / à échanger" lens — narrows the grid to pieces the
  // owner has listed on their trade shelf.
  const saleOnly = view.sale;
  const setSaleOnly = (v) => setView({ sale: typeof v === "function" ? v(saleOnly) : v });
  // "À la une" — one piece pinned to the top. Stored client-side (a per-device
  // display choice, no backend field); when nothing is pinned the featured
  // block simply doesn't render.
  const [pinnedId, setPinnedId] = useState(() => {
    try {
      return localStorage.getItem("fc:pinned-owned");
    } catch {
      return null;
    }
  });
  const pin = (id) => {
    try {
      if (id) localStorage.setItem("fc:pinned-owned", id);
      else localStorage.removeItem("fc:pinned-owned");
    } catch {
      /* private mode — keep in-memory only */
    }
    setPinnedId(id);
  };
  // Bulk-edit mode: turn the grid into a multi-select surface with an action bar.
  const [selectMode, setSelectMode] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [pendingBulkDelete, setPendingBulkDelete] = useState(false);
  // Owned-item queued for deletion confirmation; null when the dialog is closed.
  const [pendingRemove, setPendingRemove] = useState(null);

  const archivedCount = useMemo(
    () => (owned.data ?? []).filter((o) => o.archived_at).length,
    [owned.data],
  );

  const stats = useMemo(() => {
    const data = owned.data ?? [];
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
      vitrines: vitrines.size,
      preorders,
      value: dominant(effectiveValue),
      paid: dominant(figurePaid),
    };
  }, [owned.data]);

  const countsByCondition = useMemo(() => {
    const m = new Map();
    for (const o of owned.data ?? []) {
      m.set(o.condition, (m.get(o.condition) ?? 0) + 1);
    }
    return m;
  }, [owned.data]);

  const saleCount = useMemo(
    () => (owned.data ?? []).filter((o) => o.for_sale || o.for_trade).length,
    [owned.data],
  );

  const dc = useDisplayCurrency();

  const filtered = useMemo(() => {
    // When a tag is selected the grid is sourced from the server-side
    // `?tag=`-filtered fetch; otherwise the full collection. Condition + sale
    // lenses still narrow client-side on top of either.
    let list = (tagFilter ? tagged.data : owned.data) ?? [];
    if (saleOnly) list = list.filter((o) => o.for_sale || o.for_trade);
    if (conditionFilter !== "all") {
      list = list.filter((o) => o.condition === conditionFilter);
    }
    const needle = q.trim().toLowerCase();
    if (needle) {
      // Match the fields a collector actually recalls a piece by. Plain
      // substring, no fuzzy: on your own shelf you know what you're looking
      // for, and a surprise match is worse than none.
      list = list.filter((o) =>
        [o.figure_name, o.manufacturer_name, o.version_name, o.location]
          .filter(Boolean)
          .some((s) => String(s).toLowerCase().includes(needle)),
      );
    }

    // Amounts are stored per-currency, so every money sort converts through
    // the display currency first — otherwise ¥30 000 sorts under €200.
    const money = (v) =>
      v == null ? null : toDisplay(dc.rates, dc.display, v.amount, v.currency);
    const valueOf = (o) => money(effectiveValue(o));
    const gainOf = (o) => {
      const v = money(effectiveValue(o));
      const p = money(figurePaid(o));
      return v == null || p == null ? null : v - p;
    };
    // Nulls always sink, whichever direction the key sorts.
    const desc = (pick) => (a, b) => {
      const x = pick(a);
      const y = pick(b);
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      return y - x;
    };
    const sorted = [...list];
    switch (sort) {
      case "name":
        sorted.sort((a, b) =>
          String(a.figure_name ?? "").localeCompare(String(b.figure_name ?? ""), undefined, {
            sensitivity: "base",
          }),
        );
        break;
      case "value":
        sorted.sort(desc(valueOf));
        break;
      case "gain":
        sorted.sort(desc(gainOf));
        break;
      case "purchase":
        sorted.sort(desc((o) => (o.purchase_date ? Date.parse(o.purchase_date) : null)));
        break;
      default: // recent
        sorted.sort(desc((o) => (o.created_at ? Date.parse(o.created_at) : null)));
    }
    return sorted;
  }, [owned.data, tagged.data, tagFilter, conditionFilter, saleOnly, q, sort, dc.rates, dc.display]);

  // Plate density — `auto` follows the size of the shelf; an explicit pick wins.
  const { density, setDensity, resolved: resolvedDensity } = useGridDensity(
    "fc.collection.density",
    filtered.length,
  );

  // Grow-on-demand paging. Reset whenever the result set changes identity so a
  // new filter never opens on page 7 of the previous one.
  const [page, setPage] = useState(1);
  const filterKey = `${q}|${sort}|${conditionFilter}|${tagFilter ?? ""}|${saleOnly}|${showArchived}`;
  const [seenKey, setSeenKey] = useState(filterKey);
  if (seenKey !== filterKey) {
    setSeenKey(filterKey);
    setPage(1);
  }
  const visible = useMemo(() => filtered.slice(0, page * PAGE), [filtered, page]);

  // Come back to where you left off, once the plate has actually rendered.
  useScrollRestoration("collection", !owned.isLoading && filtered.length > 0);

  // The pinned piece, resolved against the live collection (ignored if it was
  // since removed/archived).
  const pinnedItem = useMemo(
    () => (pinnedId ? (owned.data ?? []).find((o) => o.id === pinnedId && !o.archived_at) : null),
    [owned.data, pinnedId],
  );

  const ids = useMemo(() => filtered.map((o) => o.id), [filtered]);
  const sel = useRowSelection(ids);

  if (me.isLoading) return null;
  if (!me.data?.authenticated) return <Navigate to="/login" replace />;

  if (owned.isError) {
    return (
      <AppShell>
        <PageLayout width="wide">
          <ErrorState error={owned.error} onRetry={() => owned.refetch()} />
        </PageLayout>
      </AppShell>
    );
  }

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

  const nsfwPref = me.data?.user?.nsfw_visibility ?? "hide";
  const nsfwBlur = (item) => item.is_nsfw && nsfwPref === "blur";
  const hasPieces = !!owned.data?.length;

  return (
    <AppShell>
      <PageLayout
        kicker={t("collection.kicker", { default: "COLLECTION · 蒐 · MES PIÈCES" })}
        title={t("collection.title")}
        kanji="蒐"
        width="wide"
        toolbar={
          hasPieces ? (
            <Button
              as={Link}
              to="/figures/new"
              variant="primary"
              size="sm"
              iconStart={<Plus size={16} />}
              className="uppercase"
            >
              {t("collection.add", { default: "Ajouter une pièce" })}
            </Button>
          ) : null
        }
      >
        {/* ── Loading / empty / gallery ── */}
        {owned.isLoading ? (
          <SectionSkeleton />
        ) : !hasPieces ? (
          <EmptyState
            kanji="空"
            eyebrow={t("collection.empty.eyebrow")}
            title={t("collection.empty.title")}
            body={t("collection.empty.body")}
          >
            <Button as={Link} to="/catalogue" variant="primary">
              {t("collection.empty.cta_browse")}
            </Button>
            <Button as={Link} to="/figures/new" variant="ghost">
              {t("collection.empty.cta")}
            </Button>
          </EmptyState>
        ) : (
          <>
            <CollectionHeader
              t={t}
              stats={stats}
              saleCount={saleCount}
              saleOnly={saleOnly}
              onToggleSale={() => setSaleOnly((v) => !v)}
              selectMode={selectMode}
              onToggleSelect={() => (selectMode ? exitSelect() : setSelectMode(true))}
              canSelect={hasPieces}
            />

            {pinnedItem ? (
              <div className="mt-10">
                <FeaturedPiece item={pinnedItem} t={t} onUnpin={() => pin(null)} />
              </div>
            ) : null}

            <div className="mt-8">
              <ConditionFilterRail
                t={t}
                conditionFilter={conditionFilter}
                onSelect={setConditionFilter}
                countsByCondition={countsByCondition}
                totalCount={owned.data.length}
                showArchived={showArchived}
                onToggleArchived={() => setShowArchived((v) => !v)}
                archivedCount={archivedCount}
              />
            </div>

            {/* Appearance-tag facet — self-hides until the user has tagged
                photos (tagging worker has run + feature on). */}
            <div className="mt-6">
              <TagFilterRail
                t={t}
                facets={photoTags.data}
                tagFilter={tagFilter}
                onSelect={setTagFilter}
              />
            </div>

            <div className="mt-8">
              <CollectionToolbar
                t={t}
                q={q}
                onQ={(v) => setView({ q: v })}
                sort={sort}
                onSort={(v) => setView({ sort: v })}
                density={density}
                onDensity={setDensity}
                shown={visible.length}
                total={filtered.length}
              />
            </div>

            <div className="mt-6">
              <CollectionGrid
                t={t}
                items={visible}
                density={resolvedDensity}
                nsfwBlur={nsfwBlur}
                pinnedId={pinnedId}
                onPin={pin}
                onRequestRemove={setPendingRemove}
                removePending={remove.isPending}
                selectMode={selectMode}
                sel={sel}
                bulkBusy={bulkBusy}
                locationOptions={locationOptions}
                onBulkSetLocation={bulkSetLocation}
                onBulkSetCondition={bulkSetCondition}
                onBulkArchive={bulkArchive}
                onBulkDelete={() => setPendingBulkDelete(true)}
                onExitSelect={exitSelect}
              />

              {visible.length < filtered.length ? (
                <div className="mt-8 flex justify-center">
                  <Button variant="subtle" onClick={() => setPage((p) => p + 1)}>
                    {t("collection.loadmore")}
                  </Button>
                </div>
              ) : null}
            </div>
          </>
        )}

        {/* Recommandé pour toi — self-hides when photo search is off or there's
            nothing to suggest. */}
        <RecommendedShelf t={t} nsfwPref={nsfwPref} />
      </PageLayout>

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

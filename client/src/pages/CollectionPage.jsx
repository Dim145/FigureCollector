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
export default function CollectionPage() {
  const t = useT();
  const me = useMe();
  // `showArchived` surfaces the optional "annulées" pass (preorder
  // cancellations kept with a partial / no refund). Off by default so the
  // active collection stays the focus; promoted into the filter rail as a facet.
  const [showArchived, setShowArchived] = useState(false);
  const owned = useOwnedItems({ includeArchived: showArchived });
  // Appearance-tag facet (WD-Tagger on the user's own photos). The chip list is
  // built from the unfiltered facets; selecting one narrows the grid via a
  // server-side `?tag=` fetch (tags live on photos, not on the owned row, so the
  // filtering can't be done client-side from `owned.data`).
  const [tagFilter, setTagFilter] = useState(null);
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
  const [conditionFilter, setConditionFilter] = useState("all");
  // Optional "à vendre / à échanger" lens — narrows the grid to pieces the
  // owner has listed on their trade shelf.
  const [saleOnly, setSaleOnly] = useState(false);
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

  const filtered = useMemo(() => {
    // When a tag is selected the grid is sourced from the server-side
    // `?tag=`-filtered fetch; otherwise the full collection. Condition + sale
    // lenses still narrow client-side on top of either.
    let list = (tagFilter ? tagged.data : owned.data) ?? [];
    if (saleOnly) list = list.filter((o) => o.for_sale || o.for_trade);
    if (conditionFilter !== "all") {
      list = list.filter((o) => o.condition === conditionFilter);
    }
    return list;
  }, [owned.data, tagged.data, tagFilter, conditionFilter, saleOnly]);

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
              <CollectionGrid
                t={t}
                items={filtered}
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

import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { SlidersHorizontal } from "lucide-react";
import { api } from "../lib/api.js";
import { useI18n, useT } from "../i18n/index.jsx";
import { useMe } from "../hooks/useMe.js";
import { useFigureTypes } from "../hooks/useAdmin.js";
import { useVisualSearchStatus, useVisualClusters } from "../hooks/useVisualSearch.js";
import { useFigures, useOwnedItems, useTagFacets } from "../hooks/useCollection.js";
import { useWishlistItems } from "../hooks/useWishlist.js";
import { useSemanticSearch } from "../hooks/useSemanticSearch.js";
import { useLookSearch } from "../hooks/useLookSearch.js";
import { stashCapturedFile } from "../lib/visualSearchStash.js";
import AppShell from "../components/AppShell.jsx";
import ErrorState from "../components/ErrorState.jsx";
import { PageLayout } from "../components/layout/index.js";
import { Button, Tabs, Drawer } from "../components/ui/index.js";
import BarcodeScanner from "../components/BarcodeScanner.jsx";
import BrowseHeader from "./catalogue/BrowseHeader.jsx";
import SearchBar from "./catalogue/SearchBar.jsx";
import BrowseFilters from "./catalogue/BrowseFilters.jsx";
import CatalogueResults, { FigureGrid } from "./catalogue/CatalogueResults.jsx";
import SemanticResults from "./catalogue/SemanticResults.jsx";
import AmbianceGallery, { AmbianceDrillIn } from "./catalogue/AmbianceGallery.jsx";
import SearchModesHelpModal from "./catalogue/SearchModesHelpModal.jsx";

// Fallback used only when `/figure-types` hasn't responded yet (first paint or
// offline). The live rail is driven by the admin-curated registry so custom
// types appear automatically and the kanji never goes stale.
const TYPES_FALLBACK = [
  { id: "nendoroid", kanji: "童" },
  { id: "scale", kanji: "像" },
  { id: "figma", kanji: "動" },
  { id: "prize", kanji: "賞" },
  { id: "trading", kanji: "交" },
  { id: "statue", kanji: "彫" },
  { id: "plamo", kanji: "組" },
  { id: "bishoujo", kanji: "美" },
  { id: "dakimakura", kanji: "枕" },
  { id: "other", kanji: "玩" },
];

const SORT_OPTIONS = [
  { value: "recent", labelKey: "browse.sort.recent" },
  { value: "name", labelKey: "browse.sort.name" },
  { value: "release", labelKey: "browse.sort.release" },
  { value: "scale", labelKey: "browse.sort.scale" },
];

// SigLIP (Apparence) cross-modal cosine sits genuinely low (~0.05–0.16) and its
// own sigmoid calibration reads ~0 % for out-of-domain figure photos, so a raw
// % looks broken. We rescale that observed band to a readable 0–100 relevance
// score (ranking unchanged). e5 (Description) sims already sit in a credible
// band, so those are used directly.
const clipMatchPct = (dist) => {
  const sim = 1 - dist;
  return Math.max(0, Math.min(100, Math.round(((sim - 0.03) / 0.12) * 100)));
};

/**
 * Catalogue (`/catalogue`) — discover catalog figures by keyword / semantic
 * ("Description") / visual ("Apparence") / barcode / photo, with type-tile and
 * tag facets and DINOv2 "ambiance" clusters.
 *
 * Thin orchestrator: owns the data hooks, the search/view/filter state, and the
 * two on-device embedding searches (delegated to useSemanticSearch /
 * useLookSearch), then composes the page-local parts on the shared foundation:
 *
 *   BrowseHeader          — figurine-metrics KPI strip
 *   SearchBar             — the single search station (modes + camera + scan)
 *   BrowseFilters         — kanji type rail + active-tag pill + popular tags
 *   CatalogueResults      — the default keyword grid (loading / empty owned)
 *   SemanticResults       — staged on-device results (Description / Apparence)
 *   AmbianceGallery       — DINOv2 visual-style clusters + drill-in
 *   SearchModesHelpModal  — the "?"-reachable explainer
 *
 * The Catalogue ↔ Ambiances toggle is an in-page Tabs view, not a route. Pairs
 * with /collection (same artifact cards + kanji rail); hero accent kanji 目
 * (eye) vs the collection's 蒐 (gather).
 */
export default function BrowsePage() {
  const t = useT();
  const { locale } = useI18n();
  const me = useMe();
  const navigate = useNavigate();
  const figureTypes = useFigureTypes();

  // ── Search + view state ────────────────────────────────────────────────────
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const [sort, setSort] = useState("recent");
  // "catalogue" (flat grid) ↔ "ambiances" (visual-style clusters).
  const [viewMode, setViewMode] = useState("catalogue");
  const [openCluster, setOpenCluster] = useState(null);
  // Search mode within the catalogue view: keyword filter, semantic (e5) text
  // search, or "look" (SigLIP text→image / Apparence).
  const [searchMode, setSearchMode] = useState("keyword");
  const [searchHelpOpen, setSearchHelpOpen] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false); // mobile filter drawer

  // Appearance-tag filter, driven by the URL (`/catalogue?tag=elf`) so figure-
  // page chips deep-link into a filtered catalogue and the filter is shareable.
  const [searchParams, setSearchParams] = useSearchParams();
  const tag = searchParams.get("tag") || "";
  const setTag = useCallback(
    (next) =>
      setSearchParams((prev) => {
        const p = new URLSearchParams(prev);
        if (next) p.set("tag", next);
        else p.delete("tag");
        return p;
      }),
    [setSearchParams],
  );

  // Photo search is gated on the feature flag (same as the nav entry).
  const { data: vsStatus } = useVisualSearchStatus();
  const tagFacets = useTagFacets();
  const wishlist = useWishlistItems();
  const owned = useOwnedItems();

  // 250 ms debounce on the query — without it useFigures() / the embedders fire
  // on every keystroke (a roundtrip + a fresh cache key per character).
  const [debouncedQ, setDebouncedQ] = useState("");
  useEffect(() => {
    const id = setTimeout(() => setDebouncedQ(q), 250);
    return () => clearTimeout(id);
  }, [q]);

  // ── Mode resolution ─────────────────────────────────────────────────────────
  // An active tag filter forces the flat catalogue (it's a catalogue facet, not
  // a semantic/ambiance mode), so the tag-filtered grid always shows.
  const ambiance = !!vsStatus?.enabled && !!vsStatus?.ambiances && viewMode === "ambiances" && !tag;
  const isSemantic =
    !ambiance && !tag && searchMode === "semantic" && !!vsStatus?.text_search_enabled;
  const isLook = !ambiance && !tag && searchMode === "look" && !!vsStatus?.clip_search_enabled;

  // Keyword mode filters server-side; ambiance/semantic/look load the full
  // catalogue (they pick figures another way), so a drill-in can map cluster
  // member ids straight onto loaded figures.
  const figures = useFigures({
    q: ambiance || isSemantic || isLook ? undefined : debouncedQ.trim() || undefined,
    figure_type: ambiance ? undefined : type || undefined,
    tag: tag || undefined,
  });
  const clusters = useVisualClusters({ enabled: ambiance });

  // The two on-device searches — gated on their live mode + a debounced query.
  const semantic = useSemanticSearch({ active: isSemantic, query: debouncedQ });
  const look = useLookSearch({ active: isLook, query: debouncedQ });

  // Barcode scan → catalogue lookup by JAN: a hit opens the figure; an unknown
  // barcode jumps to the add page with the JAN pre-filled.
  const onScan = useCallback(
    async (jan) => {
      setScanOpen(false);
      try {
        const fig = await api.get(`/figures/by-jan?jan=${encodeURIComponent(jan)}`);
        if (fig?.id) {
          navigate(`/figures/${fig.id}`);
          return;
        }
      } catch {
        /* unknown / error → fall through to manual add */
      }
      navigate(`/figures/new?jan=${encodeURIComponent(jan)}`);
    },
    [navigate],
  );

  // Camera → photo search. The pick happens inside the user's tap (so the native
  // camera/gallery chooser actually opens), then we stash the File and hand off
  // to /catalogue/photo, which embeds + searches it on arrival.
  const onPhoto = useCallback(
    (file) => {
      if (!file) return;
      stashCapturedFile(file);
      navigate("/catalogue/photo");
    },
    [navigate],
  );

  // Live rail tiles. Falls back to the hard-coded list while `/figure-types` is
  // still loading or empty.
  const typeTiles = useMemo(() => {
    const rows = figureTypes.data;
    if (Array.isArray(rows) && rows.length > 0) {
      return rows.map((ft) => ({
        id: ft.id,
        // Only accept a real Han glyph — a stray Latin kanji (e.g. a "tests"
        // type saved with kanji "t") falls back to 玩 rather than showing "t".
        kanji: ft.kanji && /\p{Script=Han}/u.test(ft.kanji) ? ft.kanji : "玩",
        label: (locale === "fr" ? ft.label_fr : ft.label_en) || ft.id,
      }));
    }
    return TYPES_FALLBACK.map((row) => ({
      id: row.id,
      kanji: row.kanji,
      label: t(`type.${row.id}`),
    }));
  }, [figureTypes.data, locale, t]);

  // Search modes offered (admin-gated). Drives the SegmentedControl.
  const searchModes = useMemo(
    () => [
      { value: "keyword", label: t("browse.search.keyword", { default: "Mots-clés" }) },
      ...(vsStatus?.text_search_enabled
        ? [{ value: "semantic", label: t("browse.search.semantic", { default: "Description" }) }]
        : []),
      ...(vsStatus?.clip_search_enabled
        ? [{ value: "look", label: t("browse.search.look", { default: "Apparence" }) }]
        : []),
    ],
    [vsStatus?.text_search_enabled, vsStatus?.clip_search_enabled, t],
  );

  // Popular tags, already ordered by figure count (= relevance) from the server.
  // Capped generously so "+N" can reveal a meaningful tail.
  const popularTags = useMemo(() => (tagFacets.data ?? []).slice(0, 40), [tagFacets.data]);

  // Per-user catalogue markers — derived from the already-cached wishlist and
  // collection lists (no extra request).
  const wishedIds = useMemo(
    () => new Set((wishlist.data ?? []).map((w) => w.figure_id)),
    [wishlist.data],
  );
  const ownedIds = useMemo(() => new Set((owned.data ?? []).map((o) => o.figure_id)), [owned.data]);

  // Per-type counts for the rail's superscript markers.
  const countsByType = useMemo(() => {
    const m = new Map();
    for (const f of figures.data ?? []) {
      m.set(f.figure_type, (m.get(f.figure_type) ?? 0) + 1);
    }
    return m;
  }, [figures.data]);

  // Client-side sort so the user can reshuffle without hitting the server.
  const sorted = useMemo(() => {
    const arr = [...(figures.data ?? [])];
    switch (sort) {
      case "name":
        return arr.sort((a, b) =>
          String(a.name).localeCompare(String(b.name), undefined, { sensitivity: "base" }),
        );
      case "release":
        return arr.sort((a, b) => {
          const ax = a.release_date ?? "";
          const bx = b.release_date ?? "";
          if (!ax && !bx) return 0;
          if (!ax) return 1;
          if (!bx) return -1;
          return bx.localeCompare(ax);
        });
      case "scale":
        return arr.sort((a, b) => String(a.scale ?? "").localeCompare(String(b.scale ?? "")));
      case "recent":
      default:
        // Server already orders by created_at DESC.
        return arr;
    }
  }, [figures.data, sort]);

  // Type-slug → { kanji, label } for ambiance cluster labels.
  const typeMeta = useMemo(() => {
    const m = new Map();
    for (const tt of typeTiles) m.set(tt.id, tt);
    return m;
  }, [typeTiles]);

  // Drill-in: a cluster's members mapped onto the loaded catalogue, in centroid
  // order (member_ids comes closest-first).
  const clusterFigures = useMemo(() => {
    if (!openCluster) return [];
    const byId = new Map((figures.data ?? []).map((f) => [f.id, f]));
    return openCluster.member_ids.map((id) => byId.get(id)).filter(Boolean);
  }, [openCluster, figures.data]);

  if (me.isLoading) return null;
  if (!me.data?.authenticated) return <Navigate to="/login" replace />;

  // The keyword catalogue query failing used to fall through to an empty grid
  // with no signal; surface it like StatsPage so the page stops failing
  // silently (the on-device search modes carry their own inline error states).
  if (figures.isError) {
    return (
      <AppShell>
        <PageLayout
          kicker={t("browse.subtitle")}
          title={t("browse.title")}
          kanji="目"
          width="wide"
        >
          <ErrorState error={figures.error} onRetry={() => figures.refetch()} />
        </PageLayout>
      </AppShell>
    );
  }

  const total = figures.data?.length ?? 0;
  const semanticFigures = (semantic.results ?? []).map((r) => r.figure);
  const lookFigures = (look.results ?? []).map((r) => r.figure);
  // figure id → DISPLAY "% match" — the grid stamps it like the discovery rails.
  const semanticScores = new Map(
    (semantic.results ?? []).map((r) => [r.figure.id, Math.round((1 - r.distance) * 100)]),
  );
  const lookScores = new Map(
    (look.results ?? []).map((r) => [r.figure.id, clipMatchPct(r.distance)]),
  );

  // Ambiances live as a Tabs view, gated on the feature flag.
  const ambianceAvailable = !!vsStatus?.enabled && !!vsStatus?.ambiances;
  const viewTabs = [
    { value: "catalogue", label: t("browse.view.catalogue", { default: "Catalogue" }) },
    { value: "ambiances", label: t("browse.view.ambiances", { default: "Ambiances" }) },
  ];

  // Sort lives in the PageLayout toolbar; hidden in the ambiance view (it sorts
  // the flat grid, which isn't on screen there).
  const sortControl = !ambiance ? (
    <label className="toolbar-pill">
      <span aria-hidden className="text-[10px] opacity-60">
        ⇅
      </span>
      <select
        value={sort}
        onChange={(e) => setSort(e.target.value)}
        aria-label={t("browse.sort.aria")}
      >
        {SORT_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {t(o.labelKey)}
          </option>
        ))}
      </select>
    </label>
  ) : null;

  // Whether the facet rail applies (keyword catalogue only — not in the on-device
  // search modes or the ambiance view).
  const showFilters = !ambiance && !isSemantic && !isLook;
  const filtersNode = (
    <BrowseFilters
      t={t}
      total={total}
      typeTiles={typeTiles}
      type={type}
      onSelectType={setType}
      countsByType={countsByType}
      tag={tag}
      onSelectTag={setTag}
      popularTags={popularTags}
    />
  );

  // What the body renders.
  let body;
  if (ambiance && !openCluster) {
    body = (
      <AmbianceGallery query={clusters} typeMeta={typeMeta} onOpen={setOpenCluster} me={me} t={t} />
    );
  } else if (ambiance && openCluster) {
    body = (
      <AmbianceDrillIn
        cluster={openCluster}
        typeMeta={typeMeta}
        onBack={() => setOpenCluster(null)}
        t={t}
      >
        <FigureGrid
          figures={clusterFigures}
          ownedIds={ownedIds}
          wishedIds={wishedIds}
          me={me}
          t={t}
        />
      </AmbianceDrillIn>
    );
  } else if (isSemantic) {
    body = (
      <SemanticResults
        kind="semantic"
        state={semantic}
        hasQuery={!!debouncedQ.trim()}
        figures={semanticFigures}
        scores={semanticScores}
        ownedIds={ownedIds}
        wishedIds={wishedIds}
        me={me}
        t={t}
      />
    );
  } else if (isLook) {
    body = (
      <SemanticResults
        kind="look"
        state={look}
        hasQuery={!!debouncedQ.trim()}
        figures={lookFigures}
        scores={lookScores}
        ownedIds={ownedIds}
        wishedIds={wishedIds}
        me={me}
        t={t}
      />
    );
  } else {
    body = (
      <CatalogueResults
        figures={sorted}
        loading={figures.isLoading}
        ownedIds={ownedIds}
        wishedIds={wishedIds}
        me={me}
        t={t}
      />
    );
  }

  return (
    <AppShell>
      <PageLayout
        kicker={t("browse.subtitle")}
        title={t("browse.title")}
        kanji="目"
        width="wide"
        toolbar={sortControl}
      >
        <BrowseHeader
          t={t}
          total={total}
          ownedCount={ownedIds.size}
          wishedCount={wishedIds.size}
          typeCount={countsByType.size}
        />

        {/* View tabs (Catalogue ↔ Ambiances) — in-page, no route. Wrapped in a
            labelled nav so the tablist has an accessible name. */}
        {ambianceAvailable ? (
          <nav className="mt-8" aria-label={t("browse.view.aria", { default: "Mode d'affichage" })}>
            <Tabs
              tabs={viewTabs}
              value={viewMode}
              onChange={(v) => {
                setViewMode(v);
                setOpenCluster(null);
              }}
            />
          </nav>
        ) : null}

        {/* Search station — the primary affordance. Hidden in the ambiance view
            (which discovers figures visually, not by query). */}
        {!ambiance ? (
          <div className="mt-8">
            <SearchBar
              t={t}
              query={q}
              onQueryChange={setQ}
              searchModes={searchModes}
              mode={searchMode}
              onModeChange={setSearchMode}
              isSemantic={isSemantic}
              isLook={isLook}
              photoEnabled={!!vsStatus?.enabled}
              onPhoto={onPhoto}
              onScan={() => setScanOpen(true)}
              onOpenHelp={() => setSearchHelpOpen(true)}
            />
          </div>
        ) : null}

        {/* Facets — inline on desktop, a "Filtres" drawer on mobile. */}
        {showFilters ? (
          <>
            <div className="mt-6 hidden md:block">{filtersNode}</div>
            <div className="mt-4 md:hidden">
              <Button
                variant="ghost"
                size="sm"
                iconStart={<SlidersHorizontal size={15} />}
                onClick={() => setFiltersOpen(true)}
              >
                {t("browse.filters.open", { default: "Filtres" })}
                {type || tag ? (
                  <span
                    aria-hidden
                    className="ml-1 inline-block w-1.5 h-1.5 rounded-full bg-[var(--color-laque-bright)]"
                  />
                ) : null}
              </Button>
            </div>
          </>
        ) : null}

        <div className="mt-8">{body}</div>
      </PageLayout>

      {/* Mobile filters drawer — only while the facets actually apply, so
          switching to a semantic/ambiance mode can't leave it open with stale
          facets on screen. */}
      <Drawer
        open={filtersOpen && showFilters}
        onClose={() => setFiltersOpen(false)}
        side="bottom"
        title={t("browse.filters.open", { default: "Filtres" })}
      >
        {filtersNode}
      </Drawer>

      <SearchModesHelpModal
        open={searchHelpOpen}
        onClose={() => setSearchHelpOpen(false)}
        t={t}
        vsStatus={vsStatus}
      />

      {scanOpen ? <BarcodeScanner onDetect={onScan} onClose={() => setScanOpen(false)} /> : null}
    </AppShell>
  );
}

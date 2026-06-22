import { useCallback, useEffect, useId, useMemo, useState } from "react";
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
import { useCatalogueFacets, useCatalogueDiscover, useRecentSearches } from "../hooks/useCatalogue.js";
import { stashCapturedFile } from "../lib/visualSearchStash.js";
import AppShell from "../components/AppShell.jsx";
import ErrorState from "../components/ErrorState.jsx";
import { PageLayout } from "../components/layout/index.js";
import { Button, Tabs, Drawer } from "../components/ui/index.js";
import { SectionSkeleton } from "../components/Skeleton.jsx";
import BarcodeScanner from "../components/BarcodeScanner.jsx";
import BrowseHeader from "./catalogue/BrowseHeader.jsx";
import SearchBar from "./catalogue/SearchBar.jsx";
import SearchAutocomplete from "./catalogue/SearchAutocomplete.jsx";
import BrowseFilters from "./catalogue/BrowseFilters.jsx";
import FacetRail from "./catalogue/FacetRail.jsx";
import AppliedChips from "./catalogue/AppliedChips.jsx";
import ExploreBento from "./catalogue/ExploreBento.jsx";
import CuratedRail from "./catalogue/CuratedRail.jsx";
import NoResultsRecovery from "./catalogue/NoResultsRecovery.jsx";
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

// How many catalogue cards show before "Charger plus" (client-side paging — the
// figures list isn't paginated server-side, so we reveal more of the loaded set).
const PAGE_SIZE = 24;

// The whole-catalogue working set the page loads up front. The figures list
// defaults to 50 rows; the discovery counts, type-rail counts, the client-side
// série/perso/échelle/tag/owned/wished filters and "Charger plus" all operate
// over this set, so it must be the full catalogue, not the 50 newest. 200 is
// the server's clamp ceiling (mirrors the admin list); beyond that we'd need
// real server-side pagination + a count endpoint.
const CATALOGUE_LIMIT = 200;

// SigLIP (Apparence) cross-modal cosine sits genuinely low (~0.05–0.16) and its
// own sigmoid calibration reads ~0 % for out-of-domain figure photos, so a raw
// % looks broken. We rescale that observed band to a readable 0–100 relevance
// score (ranking unchanged). e5 (Description) sims already sit in a credible
// band, so those are used directly.
const clipMatchPct = (dist) => {
  const sim = 1 - dist;
  return Math.max(0, Math.min(100, Math.round(((sim - 0.03) / 0.12) * 100)));
};

const emptySet = () => new Set();

/**
 * Catalogue (`/catalogue`) — "La Salle des ventes". A two-mode browse page:
 *
 *   • DISCOVERY (idle: no query, no active facet/type/tag) — an editorial front
 *     door: an ExploreBento (makers), an Ambiances entry, three CuratedRails
 *     (récemment ajoutées / pré-commandes à venir / studios favoris), then the
 *     full grid as "Tout le catalogue".
 *   • FACETTES (a query OR any active filter) — systematic results: a left
 *     FacetRail (Possédées/Souhaits/NSFW + Fabricant/Série/Personnage/Échelle/
 *     Tags), removable applied chips + "Tout effacer", sort, the grid, and a
 *     client-side "Charger plus" / "N sur M".
 *
 * The on-device Description (e5) / Apparence (SigLIP) searches and the Ambiances
 * tab stay exactly as before. Facet filtering is split: the figures endpoint
 * filters server-side by q / figure_type / tag / manufacturer (name or slug),
 * so those drive the query; série / personnage / échelle / owned / wished are
 * filtered CLIENT-SIDE over the loaded figures (the endpoint takes no such
 * params). The `?tag=` deep link is preserved and the active type + manufacturer
 * also reflect into the URL.
 */
export default function BrowsePage() {
  const t = useT();
  const { locale } = useI18n();
  const me = useMe();
  const navigate = useNavigate();
  const figureTypes = useFigureTypes();

  // ── Search + view state ────────────────────────────────────────────────────
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("recent");
  // "catalogue" (flat grid) ↔ "ambiances" (visual-style clusters).
  const [viewMode, setViewMode] = useState("catalogue");
  const [openCluster, setOpenCluster] = useState(null);
  const [searchMode, setSearchMode] = useState("keyword");
  const [searchHelpOpen, setSearchHelpOpen] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false); // mobile filter drawer
  const [autoOpen, setAutoOpen] = useState(false); // search autocomplete
  const [autoActive, setAutoActive] = useState(-1); // active autocomplete option (combobox)
  const autoListId = useId(); // shared id linking the input ↔ autocomplete listbox
  const [pageCount, setPageCount] = useState(PAGE_SIZE); // client-side "load more"

  // Client-side facet selections (the figures endpoint can't filter these).
  const [series, setSeries] = useState(emptySet);
  const [characters, setCharacters] = useState(emptySet);
  const [scales, setScales] = useState(emptySet);
  const [tagSet, setTagSet] = useState(emptySet);
  const [owned, setOwnedFilter] = useState(false);
  const [wished, setWishedFilter] = useState(false);
  // NSFW visibility in FACETTES mode. `null` = follow the account pref, so
  // blur/show viewers keep seeing NSFW (as they did before this re-arch) and
  // hide-pref viewers get none from the server anyway; an explicit boolean is
  // the rail's "Afficher NSFW" override.
  const [nsfwOverride, setNsfwOverride] = useState(null);

  // URL-driven facets: `?tag=` (figure-page chips deep-link here), plus the
  // active type + manufacturer so a filtered catalogue is shareable.
  const [searchParams, setSearchParams] = useSearchParams();
  const tag = searchParams.get("tag") || "";
  const type = searchParams.get("type") || "";
  const manufacturer = searchParams.get("manufacturer") || "";

  const patchParams = useCallback(
    (mutate) =>
      setSearchParams((prev) => {
        const p = new URLSearchParams(prev);
        mutate(p);
        return p;
      }),
    [setSearchParams],
  );
  const setTag = useCallback(
    (next) => patchParams((p) => (next ? p.set("tag", next) : p.delete("tag"))),
    [patchParams],
  );
  const setType = useCallback(
    (next) => patchParams((p) => (next ? p.set("type", next) : p.delete("type"))),
    [patchParams],
  );
  const setManufacturer = useCallback(
    (next) => patchParams((p) => (next ? p.set("manufacturer", next) : p.delete("manufacturer"))),
    [patchParams],
  );

  const { data: vsStatus } = useVisualSearchStatus();
  const tagFacets = useTagFacets();
  const wishlist = useWishlistItems();
  const ownedItems = useOwnedItems();
  const catFacets = useCatalogueFacets();
  const authed = !!me.data?.authenticated;
  const discover = useCatalogueDiscover({ enabled: authed });
  const { recent, push: pushRecent, clear: clearRecent } = useRecentSearches();

  // NSFW: the server already withholds NSFW from "hide"-pref viewers. For
  // blur/show viewers the in-page toggle governs FACETTES visibility; it
  // defaults to their account pref (null override) so the catalogue isn't
  // silently de-NSFW'd for them, matching pre-redesign behaviour.
  const nsfwPref = me.data?.user?.nsfw_visibility ?? "hide";
  const showNsfw = nsfwOverride == null ? nsfwPref !== "hide" : nsfwOverride;

  // 250 ms debounce on the query.
  const [debouncedQ, setDebouncedQ] = useState("");
  useEffect(() => {
    const id = setTimeout(() => setDebouncedQ(q), 250);
    return () => clearTimeout(id);
  }, [q]);

  // ── Mode resolution ─────────────────────────────────────────────────────────
  const hasFacet =
    !!type ||
    !!tag ||
    !!manufacturer ||
    series.size > 0 ||
    characters.size > 0 ||
    scales.size > 0 ||
    tagSet.size > 0 ||
    owned ||
    wished;
  const trimmedQ = debouncedQ.trim();
  const active = !!trimmedQ || hasFacet; // FACETTES when true, else DISCOVERY

  const ambiance = !!vsStatus?.enabled && !!vsStatus?.ambiances && viewMode === "ambiances" && !active;
  const isSemantic = !ambiance && !hasFacet && searchMode === "semantic" && !!vsStatus?.text_search_enabled;
  const isLook = !ambiance && !hasFacet && searchMode === "look" && !!vsStatus?.clip_search_enabled;

  // The keyword catalogue query — server-side filters it can do (q / type / tag /
  // manufacturer). Ambiance/semantic/look load the full catalogue (they pick
  // figures another way), so a drill-in can map cluster member ids onto them.
  const figures = useFigures({
    q: ambiance || isSemantic || isLook ? undefined : trimmedQ || undefined,
    figure_type: ambiance ? undefined : type || undefined,
    tag: tag || undefined,
    manufacturer: ambiance ? undefined : manufacturer || undefined,
    limit: CATALOGUE_LIMIT,
  });
  const clusters = useVisualClusters({ enabled: ambiance });
  const semantic = useSemanticSearch({ active: isSemantic, query: debouncedQ });
  const look = useLookSearch({ active: isLook, query: debouncedQ });

  // Reset the client-side page whenever the result set's inputs change. Done
  // during render via the "store the previous value" pattern (no effect, no
  // cascading render — React re-runs render synchronously after the setState).
  const filterSig = JSON.stringify([
    trimmedQ,
    type,
    tag,
    manufacturer,
    [...series],
    [...characters],
    [...scales],
    [...tagSet],
    owned,
    wished,
    showNsfw,
    sort,
  ]);
  const [prevSig, setPrevSig] = useState(filterSig);
  if (prevSig !== filterSig) {
    setPrevSig(filterSig);
    setPageCount(PAGE_SIZE);
  }

  // Barcode scan → catalogue lookup by JAN.
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

  // Camera → photo search.
  const onPhoto = useCallback(
    (file) => {
      if (!file) return;
      stashCapturedFile(file);
      navigate("/catalogue/photo");
    },
    [navigate],
  );

  // Live type-rail tiles (admin registry → fallback).
  const typeTiles = useMemo(() => {
    const rows = figureTypes.data;
    if (Array.isArray(rows) && rows.length > 0) {
      return rows.map((ft) => ({
        id: ft.id,
        kanji: ft.kanji && /\p{Script=Han}/u.test(ft.kanji) ? ft.kanji : "玩",
        label: (locale === "fr" ? ft.label_fr : ft.label_en) || ft.id,
      }));
    }
    return TYPES_FALLBACK.map((row) => ({ id: row.id, kanji: row.kanji, label: t(`type.${row.id}`) }));
  }, [figureTypes.data, locale, t]);

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

  const popularTags = useMemo(() => (tagFacets.data ?? []).slice(0, 40), [tagFacets.data]);

  const wishedIds = useMemo(
    () => new Set((wishlist.data ?? []).map((w) => w.figure_id)),
    [wishlist.data],
  );
  const ownedIds = useMemo(
    () => new Set((ownedItems.data ?? []).map((o) => o.figure_id)),
    [ownedItems.data],
  );

  // Per-type counts for the rail's superscript markers.
  const countsByType = useMemo(() => {
    const m = new Map();
    for (const f of figures.data ?? []) {
      m.set(f.figure_type, (m.get(f.figure_type) ?? 0) + 1);
    }
    return m;
  }, [figures.data]);

  // ── Client-side facet filter over the loaded figures ────────────────────────
  // Server already applied q / type / tag / manufacturer. Here we layer the
  // facets the endpoint can't do: série / personnage / échelle / extra tags /
  // owned / wished, plus the in-page NSFW gate.
  const clientFiltered = useMemo(() => {
    let arr = figures.data ?? [];
    if (series.size > 0) arr = arr.filter((f) => f.series_name && series.has(f.series_name));
    if (characters.size > 0)
      arr = arr.filter((f) => f.character_name && characters.has(f.character_name));
    if (scales.size > 0) arr = arr.filter((f) => f.scale && scales.has(f.scale));
    if (tagSet.size > 0) {
      arr = arr.filter((f) => {
        const tags = (f.visual_tags ?? "")
          .split(",")
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean);
        for (const want of tagSet) if (tags.includes(want.toLowerCase())) return true;
        return false;
      });
    }
    if (owned) arr = arr.filter((f) => ownedIds.has(f.id));
    if (wished) arr = arr.filter((f) => wishedIds.has(f.id));
    // NSFW gate — FACETTES mode only. The server already withholds NSFW from
    // "hide"-pref viewers, so it only reaches here for blur/show prefs. The
    // in-page "Afficher NSFW" toggle lets them suppress NSFW while browsing
    // facets without touching their account pref; off (default) drops it, on
    // keeps it. In DISCOVERY the grid follows the account pref unchanged (blur
    // shows them blurred), matching the previous behaviour.
    if (active && !showNsfw) arr = arr.filter((f) => !f.is_nsfw);
    return arr;
  }, [figures.data, active, series, characters, scales, tagSet, owned, wished, showNsfw, ownedIds, wishedIds]);

  // Sort the (filtered) set client-side.
  const sorted = useMemo(() => {
    const arr = [...clientFiltered];
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
        return arr; // server already orders by created_at DESC
    }
  }, [clientFiltered, sort]);

  const typeMeta = useMemo(() => {
    const m = new Map();
    for (const tt of typeTiles) m.set(tt.id, tt);
    return m;
  }, [typeTiles]);

  const clusterFigures = useMemo(() => {
    if (!openCluster) return [];
    const byId = new Map((figures.data ?? []).map((f) => [f.id, f]));
    return openCluster.member_ids.map((id) => byId.get(id)).filter(Boolean);
  }, [openCluster, figures.data]);

  // ── Filter actions (passed to FacetRail) ────────────────────────────────────
  const toggleInSet = useCallback((setter, value) => {
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  }, []);
  const facetActions = useMemo(
    () => ({
      toggleOwned: () => setOwnedFilter((v) => !v),
      toggleWished: () => setWishedFilter((v) => !v),
      toggleNsfw: () =>
        setNsfwOverride((prev) => !(prev == null ? nsfwPref !== "hide" : prev)),
      pickManufacturer: setManufacturer,
      toggleSet: (which, value) => {
        if (which === "series") toggleInSet(setSeries, value);
        else if (which === "characters") toggleInSet(setCharacters, value);
        else if (which === "scales") toggleInSet(setScales, value);
        else if (which === "tags") toggleInSet(setTagSet, value);
      },
    }),
    [setManufacturer, toggleInSet, nsfwPref],
  );

  // Clear every filter + the query at once.
  const clearAll = useCallback(() => {
    setQ("");
    setSeries(emptySet());
    setCharacters(emptySet());
    setScales(emptySet());
    setTagSet(emptySet());
    setOwnedFilter(false);
    setWishedFilter(false);
    setNsfwOverride(null);
    patchParams((p) => {
      p.delete("tag");
      p.delete("type");
      p.delete("manufacturer");
    });
  }, [patchParams]);

  // ── "popular" search proxy (no hook — derived from facets) ───────────────────
  const popular = useMemo(() => {
    const f = catFacets.data;
    if (!f) return [];
    const out = [];
    for (const s of (f.series ?? []).slice(0, 3)) out.push({ kind: "series", label: s.name, count: s.count });
    for (const c of (f.characters ?? []).slice(0, 2))
      out.push({ kind: "character", label: c.name, count: c.count });
    for (const tg of (f.tags ?? []).slice(0, 2)) out.push({ kind: "tag", label: tg.tag, count: tg.count });
    return out;
  }, [catFacets.data]);

  // Autocomplete suggestions: facet names matching the typed prefix.
  const suggestions = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term || !catFacets.data) return [];
    const f = catFacets.data;
    const pools = [
      { rows: f.series ?? [], get: (r) => r.name, kind: "series", kindLabel: t("browse.facets.series", { default: "Série" }) },
      { rows: f.manufacturers ?? [], get: (r) => r.name, kind: "manufacturer", kindLabel: t("figure.spec.manufacturer", { default: "Fabricant" }) },
      { rows: f.characters ?? [], get: (r) => r.name, kind: "character", kindLabel: t("browse.facets.character", { default: "Personnage" }) },
      { rows: f.tags ?? [], get: (r) => r.tag, kind: "tag", kindLabel: t("browse.facets.tag", { default: "tag" }) },
    ];
    const out = [];
    for (const pool of pools) {
      for (const r of pool.rows) {
        const value = pool.get(r);
        if (value && value.toLowerCase().includes(term)) {
          out.push({ value, kind: pool.kind, kindLabel: pool.kindLabel, count: r.count });
        }
        if (out.length >= 8) break;
      }
      if (out.length >= 8) break;
    }
    return out.slice(0, 8);
  }, [q, catFacets.data, t]);

  // Submit a search term (Enter or autocomplete pick): record it + route facets.
  const submitSearch = useCallback(
    (term, row) => {
      setAutoOpen(false);
      setAutoActive(-1);
      if (row?.type === "suggestion") {
        // A facet suggestion routes to the right filter rather than a text query.
        if (row.data?.kind === "manufacturer") {
          setManufacturer(row.value);
          setQ("");
          pushRecent(row.value);
          return;
        }
        if (row.data?.kind === "tag") {
          toggleInSet(setTagSet, row.value);
          setQ("");
          pushRecent(row.value);
          return;
        }
        if (row.data?.kind === "series") {
          toggleInSet(setSeries, row.value);
          setQ("");
          pushRecent(row.value);
          return;
        }
        if (row.data?.kind === "character") {
          toggleInSet(setCharacters, row.value);
          setQ("");
          pushRecent(row.value);
          return;
        }
      }
      if (row?.type === "popular") {
        // The popular proxy is series/character/tag — route it like a facet.
        if (row.data?.kind === "tag") toggleInSet(setTagSet, term);
        else if (row.data?.kind === "character") toggleInSet(setCharacters, term);
        else toggleInSet(setSeries, term);
        pushRecent(term);
        return;
      }
      // recent or a raw query → set the text query.
      setQ(term);
      pushRecent(term);
    },
    [setManufacturer, toggleInSet, pushRecent],
  );

  // The flat, ordered row list the autocomplete renders — kept here (not inside
  // the dropdown) so the search input owns keyboard navigation: the input is a
  // sibling of the listbox, so a handler on the listbox never sees the keys.
  // Order MUST match SearchAutocomplete: suggestions, then (empty query) recent,
  // then popular.
  const autoRows = useMemo(() => {
    const out = suggestions.map((s) => ({ type: "suggestion", value: s.value, data: s }));
    if (!q) {
      for (const r of recent) out.push({ type: "recent", value: r });
      for (const p of popular) out.push({ type: "popular", value: p.label, data: p });
    }
    return out;
  }, [suggestions, recent, popular, q]);

  // Combobox keyboard contract, owned by the input: ↑/↓ move the active option,
  // Enter selects it (or submits the raw query when none is active), Escape
  // closes. Keyword mode only — semantic/look take freeform prose.
  const onSearchKeyDown = useCallback(
    (e) => {
      const open = autoOpen && searchMode === "keyword" && autoRows.length > 0;
      if (e.key === "Escape") {
        if (open) {
          e.preventDefault();
          setAutoOpen(false);
          setAutoActive(-1);
        }
        return;
      }
      if (!open) {
        if (e.key === "Enter") {
          e.preventDefault();
          submitSearch(q);
        }
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setAutoActive((i) => (i >= autoRows.length - 1 ? 0 : i + 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setAutoActive((i) => (i <= 0 ? autoRows.length - 1 : i - 1));
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (autoActive >= 0 && autoActive < autoRows.length) {
          const row = autoRows[autoActive];
          submitSearch(row.value, row);
        } else {
          submitSearch(q);
        }
      }
    },
    [autoOpen, searchMode, autoRows, autoActive, q, submitSearch],
  );

  // Switching to Description / Apparence clears the facets: those are full-
  // catalogue lenses (they rank everything by embedding via a separate render
  // path), so a lingering facet would otherwise keep the `!hasFacet` gate shut
  // and silently strip the mode. Keyword keeps whatever is selected.
  const onModeChange = useCallback(
    (next) => {
      setSearchMode(next);
      setAutoOpen(false);
      setAutoActive(-1);
      if (next !== "keyword") {
        setSeries(emptySet());
        setCharacters(emptySet());
        setScales(emptySet());
        setTagSet(emptySet());
        setOwnedFilter(false);
        setWishedFilter(false);
        patchParams((p) => {
          p.delete("tag");
          p.delete("type");
          p.delete("manufacturer");
        });
      }
    },
    [patchParams],
  );

  if (me.isLoading) return null;
  if (!me.data?.authenticated) return <Navigate to="/login" replace />;

  if (figures.isError) {
    return (
      <AppShell>
        <PageLayout kicker={t("browse.subtitle")} title={t("browse.title")} kanji="目" width="wide">
          <ErrorState error={figures.error} onRetry={() => figures.refetch()} />
        </PageLayout>
      </AppShell>
    );
  }

  const total = figures.data?.length ?? 0;
  const matched = sorted.length;
  const shown = sorted.slice(0, pageCount);
  const semanticFigures = (semantic.results ?? []).map((r) => r.figure);
  const lookFigures = (look.results ?? []).map((r) => r.figure);
  const semanticScores = new Map(
    (semantic.results ?? []).map((r) => [r.figure.id, Math.round((1 - r.distance) * 100)]),
  );
  const lookScores = new Map((look.results ?? []).map((r) => [r.figure.id, clipMatchPct(r.distance)]));

  const ambianceAvailable = !!vsStatus?.enabled && !!vsStatus?.ambiances;
  const viewTabs = [
    { value: "catalogue", label: t("browse.view.catalogue", { default: "Catalogue" }) },
    { value: "ambiances", label: t("browse.view.ambiances", { default: "Ambiances" }) },
  ];

  const sortControl = !ambiance ? (
    <label className="toolbar-pill">
      <span aria-hidden className="text-[10px] opacity-60">
        ⇅
      </span>
      <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label={t("browse.sort.aria")}>
        {SORT_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {t(o.labelKey)}
          </option>
        ))}
      </select>
    </label>
  ) : null;

  // ── Applied-filter chips (removable), flattened from the active filters ──────
  const chips = [];
  if (trimmedQ)
    chips.push({
      id: "q",
      kind: t("browse.facets.kind_search", { default: "Recherche" }),
      label: trimmedQ,
      onRemove: () => setQ(""),
    });
  if (type) {
    const tt = typeMeta.get(type);
    chips.push({
      id: "type",
      kind: t("browse.filter_type", { default: "Type" }),
      label: tt?.label ?? type,
      onRemove: () => setType(""),
    });
  }
  if (manufacturer)
    chips.push({
      id: "manufacturer",
      kind: t("figure.spec.manufacturer", { default: "Fabricant" }),
      label: manufacturer,
      onRemove: () => setManufacturer(""),
    });
  if (tag)
    chips.push({
      id: "tag",
      kind: t("browse.facets.tag", { default: "tag" }),
      label: tag,
      onRemove: () => setTag(""),
    });
  for (const s of series)
    chips.push({
      id: `series-${s}`,
      kind: t("browse.facets.series", { default: "Série" }),
      label: s,
      onRemove: () => toggleInSet(setSeries, s),
    });
  for (const c of characters)
    chips.push({
      id: `char-${c}`,
      kind: t("browse.facets.character", { default: "Personnage" }),
      label: c,
      onRemove: () => toggleInSet(setCharacters, c),
    });
  for (const sc of scales)
    chips.push({
      id: `scale-${sc}`,
      kind: t("browse.facets.scale", { default: "Échelle" }),
      label: sc,
      onRemove: () => toggleInSet(setScales, sc),
    });
  for (const tg of tagSet)
    chips.push({
      id: `tagset-${tg}`,
      kind: t("browse.facets.tag", { default: "tag" }),
      label: tg,
      onRemove: () => toggleInSet(setTagSet, tg),
    });
  if (owned)
    chips.push({
      id: "owned",
      kind: t("browse.facets.state", { default: "État" }),
      label: t("browse.facets.owned", { default: "Possédées" }),
      onRemove: () => setOwnedFilter(false),
    });
  if (wished)
    chips.push({
      id: "wished",
      kind: t("browse.facets.state", { default: "État" }),
      label: t("browse.facets.wished", { default: "Souhaits" }),
      onRemove: () => setWishedFilter(false),
    });

  // Trending (no-results recovery) = the popular proxy, each routing to a facet.
  const trending = popular.map((p) => ({
    id: `tr-${p.kind}-${p.label}`,
    label: p.label,
    count: p.count,
    onPick: () => {
      if (p.kind === "tag") toggleInSet(setTagSet, p.label);
      else if (p.kind === "character") toggleInSet(setCharacters, p.label);
      else toggleInSet(setSeries, p.label);
    },
  }));

  const filtersState = { manufacturer, series, characters, scales, tags: tagSet, owned, wished, nsfw: showNsfw };
  const facetCounts = { owned: ownedIds.size, wished: wishedIds.size };
  const facetRailNode = (
    <FacetRail t={t} facets={catFacets.data} counts={facetCounts} filters={filtersState} actions={facetActions} />
  );

  // ── Body composition ────────────────────────────────────────────────────────
  let body;
  if (ambiance && !openCluster) {
    body = <AmbianceGallery query={clusters} typeMeta={typeMeta} onOpen={setOpenCluster} me={me} t={t} />;
  } else if (ambiance && openCluster) {
    body = (
      <AmbianceDrillIn cluster={openCluster} typeMeta={typeMeta} onBack={() => setOpenCluster(null)} t={t}>
        <FigureGrid figures={clusterFigures} ownedIds={ownedIds} wishedIds={wishedIds} me={me} t={t} />
      </AmbianceDrillIn>
    );
  } else if (isSemantic) {
    body = (
      <SemanticResults
        kind="semantic"
        state={semantic}
        hasQuery={!!trimmedQ}
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
        hasQuery={!!trimmedQ}
        figures={lookFigures}
        scores={lookScores}
        ownedIds={ownedIds}
        wishedIds={wishedIds}
        me={me}
        t={t}
      />
    );
  } else if (active) {
    // FACETTES mode — facet rail + applied chips + grid + load more.
    body = (
      <div className="cat-results-wrap">
        <span className="ja cat-watermark" aria-hidden>
          探
        </span>
        <div className="cat-results-layout">
          <aside className="cat-facets-col" aria-label={t("browse.facets.aria", { default: "Facettes" })}>
            {facetRailNode}
          </aside>
          <div className="cat-results">
            {/* Mobile: open the facet drawer + show the match count. */}
            <div className="mb-2 flex items-center gap-3 lg:hidden">
              <Button
                variant="ghost"
                size="sm"
                iconStart={<SlidersHorizontal size={15} />}
                onClick={() => setFiltersOpen(true)}
              >
                {t("browse.filters.open", { default: "Filtres" })}
                {chips.length > 0 ? (
                  <span className="ml-1.5 font-mono text-[11px] text-[var(--color-or)] num">
                    {chips.length}
                  </span>
                ) : null}
              </Button>
              <span className="font-mono text-[12px] text-[var(--on-surface-muted)] num">
                {t("browse.facets.n_results", { default: "{n} résultats", n: matched })}
              </span>
            </div>

            <AppliedChips t={t} chips={chips} onClearAll={clearAll} />
            <div className="gold-rule my-4 opacity-50" />

            {figures.isLoading ? (
              <SectionSkeleton />
            ) : matched === 0 ? (
              <NoResultsRecovery
                t={t}
                query={trimmedQ}
                chips={chips}
                onClearAll={clearAll}
                trending={trending}
              />
            ) : (
              <>
                <FigureGrid figures={shown} ownedIds={ownedIds} wishedIds={wishedIds} me={me} t={t} />
                <div className="cat-loadmore-wrap">
                  {pageCount < matched ? (
                    <button
                      type="button"
                      className="cat-loadmore"
                      onClick={() => setPageCount((n) => n + PAGE_SIZE)}
                    >
                      <span className="ja" aria-hidden>
                        続
                      </span>
                      {t("browse.loadmore", { default: "Charger plus" })}
                    </button>
                  ) : null}
                  <span className="cat-position-line">
                    {t("browse.shown_of", {
                      default: "{shown} sur {total} figurines affichées",
                      shown: Math.min(pageCount, matched),
                      total: matched,
                    })}
                  </span>
                  <span className="cat-pos-bar" aria-hidden>
                    <span
                      className="fill"
                      style={{ width: `${Math.round((Math.min(pageCount, matched) / Math.max(matched, 1)) * 100)}%` }}
                    />
                  </span>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    );
  } else {
    // DISCOVERY mode — the editorial front door.
    body = (
      <div>
        <ExploreBento
          manufacturers={catFacets.data?.manufacturers}
          onPickManufacturer={setManufacturer}
          t={t}
        />

        {ambianceAvailable ? (
          <div className="mt-12">
            <div className="cat-section-head">
              <span className="ja cat-section-kanji" aria-hidden>
                趣
              </span>
              <h2 className="cat-section-title display">
                <span className="cat-em">{t("browse.discover.ambiances_em", { default: "Ambiances" })}</span>{" "}
                {t("browse.discover.ambiances_rest", { default: "visuelles" })}
              </h2>
              <button type="button" className="cat-section-more" onClick={() => setViewMode("ambiances")}>
                {t("browse.discover.all_ambiances", { default: "Toutes les ambiances" })} →
              </button>
            </div>
            <AmbianceGallery query={clusters} typeMeta={typeMeta} onOpen={setOpenCluster} me={me} t={t} />
          </div>
        ) : null}

        <div className="mt-12">
          {discover.isLoading ? (
            <SectionSkeleton />
          ) : (
            <>
              <CuratedRail
                kanji="新"
                accent={t("browse.discover.recent_em", { default: "Récemment" })}
                title={t("browse.discover.recent_rest", { default: "ajoutées" })}
                vertical="新着"
                figures={discover.data?.recently_added}
                ownedIds={ownedIds}
                wishedIds={wishedIds}
                me={me}
                t={t}
              />
              <CuratedRail
                kanji="予"
                accent={t("browse.discover.preco_em", { default: "Pré-commandes" })}
                title={t("browse.discover.preco_rest", { default: "à venir" })}
                vertical="予約"
                figures={discover.data?.upcoming_preorders}
                ownedIds={ownedIds}
                wishedIds={wishedIds}
                me={me}
                t={t}
              />
              <CuratedRail
                kanji="推"
                accent={t("browse.discover.favs_em", { default: "De" })}
                title={t("browse.discover.favs_rest", { default: "tes studios favoris" })}
                note={(discover.data?.favorite_studios?.makers ?? []).map((m) => m.name).slice(0, 2).join(" · ")}
                vertical="贔屓"
                figures={discover.data?.favorite_studios?.figures}
                ownedIds={ownedIds}
                wishedIds={wishedIds}
                me={me}
                t={t}
              />
            </>
          )}
        </div>

        <div className="cat-mode-divider" role="separator">
          <span className="ln" aria-hidden />
          <span className="txt">
            <span className="ja" aria-hidden>
              探
            </span>
            {t("browse.discover.divider", {
              default: "quand on cherche ou filtre, le catalogue bascule en mode résultats",
            })}
          </span>
          <span className="ln" aria-hidden />
        </div>

        <div className="cat-section-head">
          <span className="ja cat-section-kanji" aria-hidden>
            全
          </span>
          <h2 className="cat-section-title display">
            <span className="cat-em">{t("browse.discover.all_em", { default: "Tout" })}</span>{" "}
            {t("browse.discover.all_rest", { default: "le catalogue" })}
          </h2>
          <span className="cat-section-meta num">
            {t("browse.total_short", { default: "{n} figurines", n: total })}
          </span>
        </div>
        <CatalogueResults
          figures={sorted}
          loading={figures.isLoading}
          ownedIds={ownedIds}
          wishedIds={wishedIds}
          me={me}
          t={t}
        />
      </div>
    );
  }

  return (
    <AppShell>
      <PageLayout
        kicker={t("browse.subtitle")}
        title={t("browse.title")}
        kanji="目"
        width="wide"
        toolbar={active && !ambiance ? sortControl : null}
      >
        <BrowseHeader
          t={t}
          total={total}
          ownedCount={ownedIds.size}
          wishedCount={wishedIds.size}
          typeCount={countsByType.size}
        />

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

        {/* Search station — primary affordance, with the autocomplete dropdown.
            Hidden in the ambiance view (which discovers figures visually). */}
        {!ambiance ? (
          <div
            className="mt-8 cat-search-station"
            onBlur={(e) => {
              // Tab-away / focus-out dismissal: close when focus leaves the
              // station entirely (clicks land on options inside it, so those
              // keep it open; the option click then fires).
              if (!e.currentTarget.contains(e.relatedTarget)) {
                setAutoOpen(false);
                setAutoActive(-1);
              }
            }}
          >
            <SearchBar
              t={t}
              query={q}
              onQueryChange={(v) => {
                setQ(v);
                setAutoOpen(true);
                setAutoActive(-1);
              }}
              onFocus={() => setAutoOpen(true)}
              onKeyDown={onSearchKeyDown}
              searchModes={searchModes}
              mode={searchMode}
              onModeChange={onModeChange}
              isSemantic={isSemantic}
              isLook={isLook}
              photoEnabled={!!vsStatus?.enabled}
              onPhoto={onPhoto}
              onScan={() => setScanOpen(true)}
              onOpenHelp={() => setSearchHelpOpen(true)}
              listId={searchMode === "keyword" ? autoListId : undefined}
              comboExpanded={autoOpen && searchMode === "keyword" && autoRows.length > 0}
              activeId={
                autoActive >= 0 && autoActive < autoRows.length
                  ? `${autoListId}-opt-${autoActive}`
                  : undefined
              }
            />
            {/* Autocomplete only for keyword mode (semantic/look take freeform prose). */}
            {searchMode === "keyword" ? (
              <SearchAutocomplete
                t={t}
                open={autoOpen}
                query={q}
                suggestions={suggestions}
                recent={recent}
                popular={popular}
                active={autoActive}
                onActiveChange={setAutoActive}
                listId={autoListId}
                onPick={submitSearch}
                onClearRecent={clearRecent}
                onClose={() => {
                  setAutoOpen(false);
                  setAutoActive(-1);
                }}
              />
            ) : null}
          </div>
        ) : null}

        {/* Kanji type rail — a quick lens in both modes, except the on-device
            search / ambiance views where a type facet doesn't compose. In
            FACETTES mode the tag pill + popular-tags rail are suppressed (the
            left FacetRail + applied chips own tag selection there), leaving just
            the type rail. */}
        {!ambiance && !isSemantic && !isLook ? (
          <div className="mt-6">
            <BrowseFilters
              t={t}
              total={total}
              typeTiles={typeTiles}
              type={type}
              onSelectType={setType}
              countsByType={countsByType}
              tag={active ? "" : tag}
              onSelectTag={setTag}
              popularTags={active ? [] : popularTags}
            />
          </div>
        ) : null}

        <div className="mt-8">{body}</div>
      </PageLayout>

      {/* Mobile facet drawer — only in FACETTES mode. The footer applies + closes. */}
      <Drawer
        open={filtersOpen && active && !isSemantic && !isLook && !ambiance}
        onClose={() => setFiltersOpen(false)}
        side="left"
        title={t("browse.filters.open", { default: "Filtres" })}
        footer={
          <button
            type="button"
            onClick={() => setFiltersOpen(false)}
            className="w-full min-h-[50px] bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white rounded-[var(--radius-md)] text-[13px] tracking-wide transition-colors"
          >
            {t("browse.facets.show_n", { default: "Afficher {n} résultats", n: matched })}
          </button>
        }
      >
        {facetRailNode}
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

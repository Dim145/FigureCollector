import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { api } from "../lib/api.js";
import { useI18n, useT } from "../i18n/index.jsx";
import { useMe } from "../hooks/useMe.js";
import { useFigureTypes } from "../hooks/useAdmin.js";
import { useVisualSearchStatus, useVisualClusters } from "../hooks/useVisualSearch.js";
import { stashCapturedFile } from "../lib/visualSearchStash.js";
import { useFigures, useOwnedItems } from "../hooks/useCollection.js";
import { useWishlistItems } from "../hooks/useWishlist.js";
import AppShell from "../components/AppShell.jsx";
import { SectionSkeleton } from "../components/Skeleton.jsx";
import StatCard from "../components/StatCard.jsx";
import BarcodeScanner from "../components/BarcodeScanner.jsx";
import FigureCard from "../components/FigureCard.jsx";
import Reveal from "../components/motion/Reveal.jsx";
import { resolveFigureCover } from "../lib/coverUrl.js";
import { typeHue } from "../lib/typeHue.js";
import {
  preorderBadgeLabel,
  preorderPhaseFromFigure,
} from "../lib/preorderStatus.js";

// Fallback used only when `/figure-types` hasn't responded yet (first paint
// or offline). The live rail is driven by the admin-curated registry so
// custom types appear automatically and the kanji never goes stale.
const TYPES_FALLBACK = [
  { id: "nendoroid", kanji: "童" },
  { id: "scale",     kanji: "像" },
  { id: "figma",     kanji: "動" },
  { id: "prize",     kanji: "賞" },
  { id: "trading",   kanji: "交" },
  { id: "statue",    kanji: "彫" },
  { id: "plamo",     kanji: "組" },
  { id: "bishoujo",  kanji: "美" },
  { id: "dakimakura", kanji: "枕" },
  { id: "other",     kanji: "玩" },
];

const SORT_OPTIONS = [
  { value: "recent", labelKey: "browse.sort.recent" },
  { value: "name", labelKey: "browse.sort.name" },
  { value: "release", labelKey: "browse.sort.release" },
  { value: "scale", labelKey: "browse.sort.scale" },
];

/**
 * Catalogue privée. The whole catalog, filterable by query + type, sortable
 * by recent / name / release date / scale.
 *
 *   - Hero column on the left (eyebrow, title, count, sort) and a *kanji-tile
 *     rail* on the right that's the type filter. The kanji is the dominant
 *     visual; the romaji caption is the legibility net.
 *   - Search bar lives directly above the rail in a unified "control strip"
 *     so the two reads as one filter station, not two unrelated widgets.
 *   - Grid uses the redesigned FigureCard (brass plaque + stamp badges).
 */
export default function BrowsePage() {
  const t = useT();
  const { locale } = useI18n();
  const me = useMe();
  const figureTypes = useFigureTypes();
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const [sort, setSort] = useState("recent");
  const navigate = useNavigate();
  const [scanOpen, setScanOpen] = useState(false);
  // "catalogue" (flat grid) ↔ "ambiances" (visual-style clusters). When an
  // ambiance is opened we drill into its members.
  const [viewMode, setViewMode] = useState("catalogue");
  const [openCluster, setOpenCluster] = useState(null);
  // Search mode within the catalogue view: keyword filter, semantic (e5) text
  // search, or "look" (SigLIP text→image / Apparence).
  const [searchMode, setSearchMode] = useState("keyword");
  const [semantic, setSemantic] = useState({ results: null, busy: false, error: false });
  const [look, setLook] = useState({ results: null, busy: false, error: false });
  // Photo search is gated on the feature flag (same as the nav entry); the
  // camera button in the search bar only appears when it's on.
  const { data: vsStatus } = useVisualSearchStatus();
  const photoInputRef = useRef(null);
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

  // Camera → photo search. The pick happens inside the user's tap (so the
  // native camera/gallery chooser actually opens), then we stash the File and
  // hand off to /recognize, which embeds + searches it on arrival.
  const onPhoto = useCallback(
    (file) => {
      if (!file) return;
      stashCapturedFile(file);
      navigate("/recognize");
    },
    [navigate],
  );

  // Live rail tiles. Falls back to the hard-coded list while the
  // `/figure-types` query is still loading or empty.
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

  // 250 ms debounce on the catalog query — without it `useFigures()` fires on
  // every keystroke, one network roundtrip per character + a fresh TanStack
  // Query cache key per call.
  const [debouncedQ, setDebouncedQ] = useState("");
  useEffect(() => {
    const id = setTimeout(() => setDebouncedQ(q), 250);
    return () => clearTimeout(id);
  }, [q]);

  // In the ambiance view we load the whole catalogue (no q/type filter) so a
  // drill-in can map a cluster's member ids straight onto loaded figures.
  const ambiance =
    !!vsStatus?.enabled && !!vsStatus?.ambiances && viewMode === "ambiances";
  const isSemantic =
    !ambiance && searchMode === "semantic" && !!vsStatus?.text_search_enabled;
  const isLook =
    !ambiance && searchMode === "look" && !!vsStatus?.clip_search_enabled;
  // Keyword mode filters the catalogue server-side; ambiance + semantic + look
  // modes load the full catalogue (they pick figures another way).
  const figures = useFigures({
    q: ambiance || isSemantic || isLook ? undefined : debouncedQ.trim() || undefined,
    figure_type: ambiance ? undefined : type || undefined,
  });
  const clusters = useVisualClusters({ enabled: ambiance });

  // Semantic search: embed the query in-browser (e5-small) and hit the
  // text-search endpoint, debounced like the keyword search.
  useEffect(() => {
    if (!isSemantic) return;
    const query = debouncedQ.trim();
    // No query → nothing to search; SemanticResults shows the prompt via
    // `hasQuery`, so we don't need to reset state here.
    if (!query) return;
    let cancelled = false;
    setSemantic((s) => ({ ...s, busy: true, error: false }));
    (async () => {
      try {
        const { embedText } = await import("../lib/embed.js");
        const embedding = await embedText(`query: ${query}`);
        if (cancelled) return;
        const results = await api.post("/me/text-search", { embedding });
        if (!cancelled) setSemantic({ results, busy: false, error: false });
      } catch {
        if (!cancelled) setSemantic({ results: null, busy: false, error: true });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isSemantic, debouncedQ]);

  // "Look" search (Apparence): embed the description with the SigLIP text tower
  // in-browser (lazy, ≈283 MB on first use) and hit the clip-search endpoint —
  // matches the query against catalogue IMAGE embeddings.
  useEffect(() => {
    if (!isLook) return;
    const query = debouncedQ.trim();
    if (!query) return;
    let cancelled = false;
    setLook((s) => ({ ...s, busy: true, error: false }));
    (async () => {
      try {
        const { embedClipText } = await import("../lib/embed.js");
        const embedding = await embedClipText(query);
        if (cancelled) return;
        const results = await api.post("/me/clip-search", { embedding });
        if (!cancelled) setLook({ results, busy: false, error: false });
      } catch {
        if (!cancelled) setLook({ results: null, busy: false, error: true });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isLook, debouncedQ]);

  // Per-user catalogue markers — derived from the already-cached wishlist and
  // collection lists (no extra request). A card shows the gold "owned" seal or
  // the laque "wished" heart in the badge corner (pre-order takes priority).
  const wishlist = useWishlistItems();
  const owned = useOwnedItems();
  const wishedIds = useMemo(
    () => new Set((wishlist.data ?? []).map((w) => w.figure_id)),
    [wishlist.data],
  );
  const ownedIds = useMemo(
    () => new Set((owned.data ?? []).map((o) => o.figure_id)),
    [owned.data],
  );

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
        return arr.sort((a, b) =>
          String(a.scale ?? "").localeCompare(String(b.scale ?? "")),
        );
      case "recent":
      default:
        // Server already orders by created_at DESC.
        return arr;
    }
  }, [figures.data, sort]);

  // Type-slug → { kanji, label } for ambiance cluster labels (reuses the rail's
  // already-localized tiles).
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

  const total = figures.data?.length ?? 0;
  // What the grid renders: semantic results in "Sens" mode, the opened
  // ambiance's members in the drill-in, else the catalogue (sorted).
  const semanticFigures = (semantic.results ?? []).map((r) => r.figure);
  const lookFigures = (look.results ?? []).map((r) => r.figure);
  // figure id → DISPLAY "% match" (the grid stamps it like the discovery rails).
  // e5 (Sens): cosine sim ×100 directly — it already sits in a credible band.
  // SigLIP (Apparence): cross-modal cosine is genuinely low (~0.05–0.16) and its
  // own sigmoid calibration reads ~0 % for out-of-domain figure photos, so a raw
  // % looks broken. We instead rescale that observed band to a readable 0–100
  // relevance score (ranking unchanged); see clipMatchPct.
  const clipMatchPct = (dist) => {
    const sim = 1 - dist;
    return Math.max(0, Math.min(100, Math.round(((sim - 0.03) / 0.12) * 100)));
  };
  const semanticScores = new Map(
    (semantic.results ?? []).map((r) => [r.figure.id, Math.round((1 - r.distance) * 100)]),
  );
  const lookScores = new Map(
    (look.results ?? []).map((r) => [r.figure.id, clipMatchPct(r.distance)]),
  );
  const gridFigures = ambiance
    ? openCluster
      ? clusterFigures
      : []
    : isSemantic
      ? semanticFigures
      : isLook
        ? lookFigures
        : sorted;

  return (
    <AppShell>
      <main className="relative max-w-7xl mx-auto px-6 pt-8 pb-16">
        {/* Atmospheric colour wash behind the hero — gold→jade→indigo mesh,
            theme-aware via the accent vars. Pure decoration, GPU-cheap. */}
        <div
          aria-hidden
          className="pointer-events-none absolute -top-24 left-0 right-0 h-[420px] -z-0"
          style={{
            background:
              "radial-gradient(50% 70% at 12% 0%, color-mix(in oklab, var(--color-or) 22%, transparent), transparent 70%), radial-gradient(45% 60% at 85% 10%, color-mix(in oklab, var(--color-ember) 16%, transparent), transparent 72%), radial-gradient(40% 55% at 55% 30%, color-mix(in oklab, var(--color-laque) 12%, transparent), transparent 75%)",
            // Feather the edges so the gradient fades instead of hard-cutting
            // at the content column (the vertical seam).
            WebkitMaskImage:
              "linear-gradient(to right, transparent 0, #000 8%, #000 92%, transparent 100%)",
            maskImage:
              "linear-gradient(to right, transparent 0, #000 8%, #000 92%, transparent 100%)",
          }}
        />
        <header className="relative mb-7">
          <span
            aria-hidden
            className="kanji-mark text-[26rem] -top-32 -right-10 hidden md:block"
          >
            目
          </span>
          <div className="grid lg:grid-cols-[1fr_auto] gap-8 items-end">
            <div>
              <p className="micro reveal" style={{ "--i": 0 }}>
                {t("browse.subtitle")}
              </p>
              <h1
                className="display text-5xl md:text-6xl mt-3 text-[var(--color-ivoire)] leading-[0.95] reveal"
                style={{ "--i": 1 }}
              >
                {t("browse.title")}
              </h1>
              <div className="gold-rule w-32 mt-6 reveal" style={{ "--i": 2 }} />
              {!figures.isLoading ? (
                <div
                  className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-3 reveal"
                  style={{ "--i": 3 }}
                >
                  <StatCard label={t("browse.title")} value={total} />
                  <StatCard
                    label={t("browse.kpi.owned")}
                    value={ownedIds.size}
                    tone="gold"
                  />
                  <StatCard
                    label={t("wishlist.title")}
                    value={wishedIds.size}
                    tone="red"
                  />
                  <StatCard
                    label={t("collection.kpi.types")}
                    value={countsByType.size}
                  />
                </div>
              ) : null}
            </div>

            {/* View mode (catalogue ↔ ambiances) + sort */}
            <div className="reveal flex items-center gap-3" style={{ "--i": 3 }}>
              {vsStatus?.enabled && vsStatus?.ambiances ? (
                <div
                  className="inline-flex border border-[var(--color-or)]/25"
                  role="tablist"
                  aria-label={t("browse.view.aria", { default: "Mode d'affichage" })}
                >
                  {[
                    { id: "catalogue", label: t("browse.view.catalogue", { default: "Catalogue" }) },
                    { id: "ambiances", label: t("browse.view.ambiances", { default: "Ambiances" }) },
                  ].map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      role="tab"
                      aria-selected={viewMode === m.id}
                      onClick={() => {
                        setViewMode(m.id);
                        setOpenCluster(null);
                      }}
                      className={`px-3.5 py-2 text-[11px] uppercase tracking-[0.18em] transition-colors ${
                        viewMode === m.id
                          ? "bg-[var(--color-or)]/15 text-[var(--color-or)]"
                          : "text-[var(--color-ivoire-soft)] hover:text-[var(--color-or)]"
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              ) : null}
              {!ambiance ? (
                <label className="toolbar-pill">
                  <span aria-hidden className="text-[10px] opacity-60">⇅</span>
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
              ) : null}
            </div>
          </div>
        </header>

        {/* ─── Control strip : search + kanji-tile filter (catalogue only) ─── */}
        {!ambiance ? (
        <section className="mb-10 reveal" style={{ "--i": 4 }}>
          {vsStatus?.text_search_enabled || vsStatus?.clip_search_enabled ? (
            <div
              className="mb-3 inline-flex border border-[var(--color-or)]/25"
              role="tablist"
              aria-label={t("browse.search.mode_aria", { default: "Mode de recherche" })}
            >
              {[
                { id: "keyword", label: t("browse.search.keyword", { default: "Mots-clés" }) },
                ...(vsStatus?.text_search_enabled
                  ? [{ id: "semantic", label: t("browse.search.semantic", { default: "Sens" }) }]
                  : []),
                ...(vsStatus?.clip_search_enabled
                  ? [{ id: "look", label: t("browse.search.look", { default: "Apparence" }) }]
                  : []),
              ].map((m) => (
                <button
                  key={m.id}
                  type="button"
                  role="tab"
                  aria-selected={searchMode === m.id}
                  onClick={() => setSearchMode(m.id)}
                  className={`px-3.5 py-1.5 text-[11px] uppercase tracking-[0.18em] transition-colors ${
                    searchMode === m.id
                      ? "bg-[var(--color-or)]/15 text-[var(--color-or)]"
                      : "text-[var(--color-ivoire-soft)] hover:text-[var(--color-or)]"
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          ) : null}
          <div className="relative mb-5">
            <span
              aria-hidden
              className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--color-or)] text-lg pointer-events-none"
            >
              ⌕
            </span>
            <input
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={
                isSemantic
                  ? t("browse.search.semantic_placeholder", {
                      default: "Par le sens — ex. mariée, statue en résine, Re:Zero…",
                    })
                  : isLook
                    ? t("browse.search.look_placeholder", {
                        default: "Par l'apparence — ex. fille aux cheveux blancs, robot mécha…",
                      })
                    : t("browse.search_placeholder")
              }
              className={`w-full pl-11 ${vsStatus?.enabled ? "pr-[6.5rem]" : "pr-14"} py-4 bg-[var(--color-noir)] border border-[var(--color-or)]/25 text-[var(--color-ivoire)] placeholder:text-[var(--color-ivoire-soft)]/40 text-lg outline-none focus:border-[var(--color-or)] transition-colors`}
              style={{ fontFamily: "var(--font-display)", letterSpacing: "-0.005em" }}
            />
            {/* Right-side input actions: photo search (gold camera) + barcode scan (jade). */}
            <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
              {vsStatus?.enabled ? (
                <>
                  {/* No `capture` attr → native camera/gallery chooser, same as /recognize. */}
                  <input
                    ref={photoInputRef}
                    type="file"
                    accept="image/*"
                    hidden
                    onChange={(e) => onPhoto(e.target.files?.[0])}
                  />
                  <button
                    type="button"
                    onClick={() => photoInputRef.current?.click()}
                    title={t("recognize.title")}
                    aria-label={t("recognize.title")}
                    className="grid place-items-center w-11 h-11 text-[var(--color-or)] hover:text-[var(--color-laque-bright)] transition-colors"
                  >
                    <svg
                      aria-hidden
                      viewBox="0 0 24 24"
                      width="21"
                      height="21"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M4 7.5h3l1.4-2.1A1 1 0 0 1 9.2 5h5.6a1 1 0 0 1 .83.45L17 7.5h3a1 1 0 0 1 1 1v9.5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8.5a1 1 0 0 1 1-1z" />
                      <circle cx="12" cy="13" r="3.3" />
                    </svg>
                  </button>
                </>
              ) : null}
              <button
                type="button"
                onClick={() => setScanOpen(true)}
                title={t("scan.title")}
                aria-label={t("scan.title")}
                className="grid place-items-center w-11 h-11 text-[var(--color-jade)] hover:text-[var(--color-or)] text-2xl leading-none transition-colors"
              >
                ⌗
              </button>
            </div>
          </div>

          {!isSemantic && !isLook ? (
          <nav
            aria-label="filter by type"
            className="tile-rail"
          >
            <FilterTile
              kanji="集"
              romaji={t("browse.filter_all")}
              count={total}
              active={type === ""}
              onClick={() => setType("")}
            />
            {typeTiles.map((tt) => (
              <FilterTile
                key={tt.id}
                typeId={tt.id}
                kanji={tt.kanji}
                romaji={tt.label}
                count={countsByType.get(tt.id) ?? 0}
                active={type === tt.id}
                onClick={() => setType(tt.id)}
              />
            ))}
          </nav>
          ) : null}
        </section>
        ) : null}

        {ambiance && !openCluster ? (
          <AmbianceGallery
            query={clusters}
            typeMeta={typeMeta}
            onOpen={setOpenCluster}
            me={me}
            t={t}
          />
        ) : ambiance && openCluster ? (
          <AmbianceDrillIn
            cluster={openCluster}
            typeMeta={typeMeta}
            onBack={() => setOpenCluster(null)}
            t={t}
          >
            <FigureGrid
              figures={gridFigures}
              ownedIds={ownedIds}
              wishedIds={wishedIds}
              me={me}
              t={t}
            />
          </AmbianceDrillIn>
        ) : isSemantic ? (
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
        ) : isLook ? (
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
        ) : figures.isLoading ? (
          <SectionSkeleton />
        ) : total === 0 ? (
          <EmptyResults t={t} />
        ) : (
          <FigureGrid
            figures={sorted}
            ownedIds={ownedIds}
            wishedIds={wishedIds}
            me={me}
            t={t}
          />
        )}
        {scanOpen ? (
          <BarcodeScanner onDetect={onScan} onClose={() => setScanOpen(false)} />
        ) : null}
      </main>
    </AppShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components

function FilterTile({ typeId, kanji, romaji, count, active, onClick }) {
  // Each type tile carries its signature hue. At rest the kanji keeps the
  // theme's neutral colour; active, it glows in the type's own colour so the
  // rail reads as a spectrum of categories. Inline styles only (the .tile
  // chrome lives in index.css).
  const hue = typeId ? typeHue(typeId) : "var(--color-or)";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`tile ${active ? "is-active" : ""}`}
      style={{ "--hue": hue }}
    >
      {count > 0 || active ? (
        <span className="tile-count" aria-hidden>
          {count}
        </span>
      ) : null}
      <span
        className="tile-kanji transition-colors duration-300"
        aria-hidden
        style={active ? { color: "var(--hue)" } : undefined}
      >
        {kanji}
      </span>
      <span className="tile-romaji">{romaji}</span>
    </button>
  );
}

function EmptyResults({ t }) {
  return (
    <div className="relative py-20 text-center">
      <span
        aria-hidden
        className="ja absolute left-1/2 -translate-x-1/2 -top-6 text-[10rem] leading-none text-[var(--color-or)]/8 select-none pointer-events-none"
      >
        無
      </span>
      <p className="micro relative">{t("browse.empty_eyebrow")}</p>
      <p className="display text-2xl text-[var(--color-ivoire)] mt-2 relative">
        {t("browse.empty")}
      </p>
    </div>
  );
}

/**
 * Semantic ("Sens") search results — prompt / busy / error / empty states, then
 * the figure grid. The query is embedded in-browser (e5-small), so the first
 * search waits on the one-time model download.
 */
function SemanticResults({
  kind = "semantic",
  state,
  hasQuery,
  figures,
  scores,
  ownedIds,
  wishedIds,
  me,
  t,
}) {
  // Per-mode copy (semantic = e5 text-match; look = SigLIP appearance-match).
  const copy =
    kind === "look"
      ? {
          prompt:
            "Décris l'apparence d'une figurine pour la retrouver — pose, couleur de cheveux, tenue…",
          busy: "Recherche par l'apparence…",
          error: "La recherche a échoué — réessaie.",
        }
      : {
          prompt:
            "Cherche par le sens : un nom, une série, une matière, un mot dans une autre langue.",
          busy: "Recherche par le sens…",
          error: "La recherche a échoué — réessaie.",
        };
  if (!hasQuery) {
    return (
      <p className="text-center text-[var(--color-ivoire-soft)] italic py-16">
        {t(`browse.search.${kind}_prompt`, { default: copy.prompt })}
      </p>
    );
  }
  if (state.busy) {
    return (
      <p className="micro text-center text-[var(--color-ivoire-soft)] py-16">
        {t(`browse.search.${kind}_busy`, { default: copy.busy })}
      </p>
    );
  }
  if (state.error) {
    return (
      <p className="text-center text-[var(--color-laque-bright)] py-16">
        {t(`browse.search.${kind}_error`, { default: copy.error })}
      </p>
    );
  }
  if (figures.length === 0) {
    return <EmptyResults t={t} />;
  }
  return (
    <FigureGrid
      figures={figures}
      scores={scores}
      ownedIds={ownedIds}
      wishedIds={wishedIds}
      me={me}
      t={t}
    />
  );
}

/**
 * The catalogue's figure grid — shared by the flat catalogue view, the ambiance
 * drill-in, and semantic results. Staggered reveal + the standard owned/wished/
 * preorder card chrome. When `scores` (id → cosine distance) is supplied, each
 * card stamps a "% match" badge instead of its preorder badge.
 */
function FigureGrid({ figures, scores, ownedIds, wishedIds, me, t }) {
  return (
    <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
      {figures.map((f, i) => (
        <Reveal as="li" key={f.id} delay={Math.min(i, 7) * 0.05} y={24}>
          <FigureCard
            figureId={f.id}
            href={`/figures/${f.id}`}
            name={f.name}
            type={f.figure_type}
            manufacturer={f.manufacturer_name ?? null}
            imageUrl={resolveFigureCover(f)}
            scale={f.scale}
            versionName={f.version_name}
            owned={ownedIds.has(f.id)}
            wished={wishedIds.has(f.id)}
            blurImage={
              f.is_nsfw && (me.data?.user?.nsfw_visibility ?? "hide") !== "show"
            }
            badge={(() => {
              // Semantic/look modes: a "% match" stamp (the scores map already
              // holds the display percent). Otherwise the preorder badge.
              const pct = scores?.get(f.id);
              if (pct != null) {
                return { label: `${pct}%`, tone: "match" };
              }
              const phase = preorderPhaseFromFigure(f);
              const label = preorderBadgeLabel(phase, t);
              return label
                ? { label, tone: phase === "imminent" ? "imminent" : "preorder" }
                : null;
            })()}
          />
        </Reveal>
      ))}
    </ul>
  );
}

/**
 * "Browse par ambiance" — a gallery of DINOv2 visual-style clusters. Each tile
 * is a 2×2 mosaic of representative covers + the dominant type + a count.
 */
function AmbianceGallery({ query, typeMeta, onOpen, me, t }) {
  if (query.isPending) return <SectionSkeleton />;
  if (query.isError) return <EmptyResults t={t} />;
  // Drop singletons — a 1-figure "vibe" (a visual outlier k-means parked on its
  // own) isn't browseable; it still shows in the flat catalogue.
  const clusters = (query.data ?? []).filter((c) => c.count >= 2);
  if (clusters.length === 0) {
    return (
      <p className="text-center text-[var(--color-ivoire-soft)] italic py-16">
        {t("browse.ambiance.empty", {
          default:
            "Pas encore assez d'images indexées pour dégager des ambiances.",
        })}
      </p>
    );
  }
  return (
    <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
      {clusters.map((c, i) => (
        <Reveal as="li" key={c.id} delay={Math.min(i, 6) * 0.06} y={24}>
          <AmbianceTile cluster={c} typeMeta={typeMeta} onOpen={onOpen} me={me} t={t} />
        </Reveal>
      ))}
    </ul>
  );
}

function AmbianceTile({ cluster, typeMeta, onOpen, me, t }) {
  const meta = typeMeta.get(cluster.dominant_type);
  const reps = cluster.representatives ?? [];
  const nsfwPref = me.data?.user?.nsfw_visibility ?? "hide";
  return (
    <button
      type="button"
      onClick={() => onOpen(cluster)}
      className="group block w-full text-left border border-[var(--color-or)]/20 bg-[var(--color-noir)]/40 hover:border-[var(--color-or)]/50 transition-colors overflow-hidden"
    >
      <div className="grid grid-cols-2 gap-px bg-[var(--color-or)]/10 aspect-[4/3]">
        {Array.from({ length: 4 }).map((_, idx) => {
          const f = reps[idx];
          return (
            <div key={idx} className="relative overflow-hidden bg-[var(--color-noir)]">
              {f ? (
                <img
                  src={resolveFigureCover(f)}
                  alt=""
                  loading="lazy"
                  className={`absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-500 ${
                    f.is_nsfw && nsfwPref === "blur" ? "nsfw-blur" : ""
                  }`}
                />
              ) : null}
            </div>
          );
        })}
      </div>
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <span className="flex items-center gap-2 min-w-0">
          <span aria-hidden className="ja not-italic text-[var(--color-or)] text-lg shrink-0">
            {meta?.kanji ?? "彩"}
          </span>
          <span
            className="truncate text-[var(--color-ivoire)]"
            style={{ fontFamily: "var(--font-display)" }}
          >
            {meta?.label ?? t("browse.ambiance.untitled", { default: "Ambiance" })}
          </span>
        </span>
        <span className="shrink-0 font-mono text-[11px] text-[var(--color-ivoire-soft)]">
          {cluster.count}
        </span>
      </div>
    </button>
  );
}

/** Drill-in header for an opened ambiance, wrapping its figure grid. */
function AmbianceDrillIn({ cluster, typeMeta, onBack, t, children }) {
  const meta = typeMeta.get(cluster.dominant_type);
  return (
    <div>
      <div className="flex items-center flex-wrap gap-x-3 gap-y-2 mb-6 reveal">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.2em] text-[var(--color-ivoire-soft)] hover:text-[var(--color-or)] transition-colors"
        >
          <span aria-hidden>←</span>
          {t("browse.ambiance.back", { default: "Ambiances" })}
        </button>
        <span aria-hidden className="text-[var(--color-or)]/30">·</span>
        <span className="flex items-center gap-2">
          <span aria-hidden className="ja not-italic text-[var(--color-or)] text-lg">
            {meta?.kanji ?? "彩"}
          </span>
          <span
            className="text-[var(--color-ivoire)]"
            style={{ fontFamily: "var(--font-display)" }}
          >
            {meta?.label ?? t("browse.ambiance.untitled", { default: "Ambiance" })}
          </span>
          <span className="font-mono text-[11px] text-[var(--color-ivoire-soft)]">
            {cluster.count}
          </span>
        </span>
      </div>
      {children}
    </div>
  );
}

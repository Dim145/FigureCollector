import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { api } from "../lib/api.js";
import { useI18n, useT } from "../i18n/index.jsx";
import { useMe } from "../hooks/useMe.js";
import { useFigureTypes } from "../hooks/useAdmin.js";
import { useFigures, useOwnedItems } from "../hooks/useCollection.js";
import { useWishlistItems } from "../hooks/useWishlist.js";
import AppShell from "../components/AppShell.jsx";
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

  const figures = useFigures({
    q: debouncedQ.trim() || undefined,
    figure_type: type || undefined,
  });

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

  if (me.isLoading) return null;
  if (!me.data?.authenticated) return <Navigate to="/login" replace />;

  const total = figures.data?.length ?? 0;

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

            {/* Sort + total cluster — sits opposite the title on lg+ */}
            <div className="reveal flex items-center gap-3" style={{ "--i": 3 }}>
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
            </div>
          </div>
        </header>

        {/* ─── Control strip : search + kanji-tile filter ─── */}
        <section className="mb-10 reveal" style={{ "--i": 4 }}>
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
              placeholder={t("browse.search_placeholder")}
              className="w-full pl-11 pr-14 py-4 bg-[var(--color-noir)] border border-[var(--color-or)]/25 text-[var(--color-ivoire)] placeholder:text-[var(--color-ivoire-soft)]/40 text-lg outline-none focus:border-[var(--color-or)] transition-colors"
              style={{ fontFamily: "var(--font-display)", letterSpacing: "-0.005em" }}
            />
            <button
              type="button"
              onClick={() => setScanOpen(true)}
              title={t("scan.title")}
              aria-label={t("scan.title")}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 grid place-items-center w-11 h-11 text-[var(--color-jade)] hover:text-[var(--color-or)] text-2xl leading-none transition-colors"
            >
              ⌗
            </button>
          </div>

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
        </section>

        {figures.isLoading ? (
          <p role="status" aria-live="polite" className="text-center text-[var(--color-ivoire-soft)] py-12">…</p>
        ) : total === 0 ? (
          <EmptyResults t={t} />
        ) : (
          <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {sorted.map((f, i) => (
              <Reveal
                as="li"
                key={f.id}
                delay={Math.min(i, 7) * 0.05}
                y={24}
              >
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
                    f.is_nsfw &&
                    (me.data?.user?.nsfw_visibility ?? "hide") === "blur"
                  }
                  badge={(() => {
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

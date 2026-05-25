import { useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { useT } from "../i18n/index.jsx";
import { useMe } from "../hooks/useMe.js";
import { useFigures } from "../hooks/useCollection.js";
import AppShell from "../components/AppShell.jsx";
import FigureCard from "../components/FigureCard.jsx";
import { resolveFigureCover } from "../lib/coverUrl.js";
import {
  preorderBadgeLabel,
  preorderPhaseFromFigure,
} from "../lib/preorderStatus.js";

const TYPES = [
  "nendoroid", "scale", "figma", "prize", "trading",
  "statue", "plamo", "bishoujo", "dakimakura", "other",
];

const KANJI_BY_TYPE = {
  nendoroid: "童", scale: "像", figma: "動", prize: "賞",
  trading: "交", statue: "彫", plamo: "組", bishoujo: "美",
  dakimakura: "枕", other: "玩",
};

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
  const me = useMe();
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const [sort, setSort] = useState("recent");

  const figures = useFigures({
    q: q.trim() || undefined,
    figure_type: type || undefined,
  });

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
      <main className="relative max-w-7xl mx-auto px-6 py-16">
        {/* ─── Hero ─── */}
        <header className="relative mb-10">
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
                className="display text-6xl md:text-7xl mt-3 text-[var(--color-ivoire)] leading-[0.95] reveal"
                style={{ "--i": 1 }}
              >
                {t("browse.title")}
              </h1>
              <div className="gold-rule w-32 mt-6 reveal" style={{ "--i": 2 }} />
              {!figures.isLoading ? (
                <p
                  className="micro-tight mt-5 reveal flex items-center gap-3"
                  style={{ "--i": 3 }}
                >
                  <span>{t("browse.total", { n: total })}</span>
                  <span
                    aria-hidden
                    className="inline-block w-1.5 h-1.5 rounded-full bg-[var(--color-or)] animate-pulse"
                  />
                </p>
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
              className="w-full pl-11 pr-4 py-4 bg-[var(--color-noir)] border border-[var(--color-or)]/25 text-[var(--color-ivoire)] placeholder:text-[var(--color-ivoire-soft)]/40 text-lg outline-none focus:border-[var(--color-or)] transition-colors"
              style={{ fontFamily: "var(--font-display)", letterSpacing: "-0.005em" }}
            />
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
            {TYPES.map((tt) => (
              <FilterTile
                key={tt}
                kanji={KANJI_BY_TYPE[tt] ?? "玩"}
                romaji={t(`type.${tt}`)}
                count={countsByType.get(tt) ?? 0}
                active={type === tt}
                onClick={() => setType(tt)}
              />
            ))}
          </nav>
        </section>

        {/* ─── Grid ─── */}
        {figures.isLoading ? (
          <p className="text-center text-[var(--color-ivoire-soft)] py-12">…</p>
        ) : total === 0 ? (
          <EmptyResults t={t} />
        ) : (
          <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {sorted.map((f, i) => (
              <li
                key={f.id}
                className="reveal"
                style={{ "--i": Math.min(i, 10) + 5 }}
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
              </li>
            ))}
          </ul>
        )}
      </main>
    </AppShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components

function FilterTile({ kanji, romaji, count, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`tile ${active ? "is-active" : ""}`}
    >
      {count > 0 || active ? (
        <span className="tile-count" aria-hidden>
          {count}
        </span>
      ) : null}
      <span className="tile-kanji" aria-hidden>
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

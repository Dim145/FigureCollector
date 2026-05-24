import { useState } from "react";
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

/**
 * Catalog (public-ish view). All figures the server returns, filterable by
 * search query + figure_type chips. The search bar floats over a faded kanji
 * for atmosphere; type chips use the same vocabulary as CollectionPage.
 */
export default function BrowsePage() {
  const t = useT();
  const me = useMe();
  const [q, setQ] = useState("");
  const [type, setType] = useState("");

  const figures = useFigures({
    q: q.trim() || undefined,
    figure_type: type || undefined,
  });

  if (me.isLoading) return null;
  if (!me.data?.authenticated) return <Navigate to="/login" replace />;

  const total = figures.data?.length ?? 0;

  return (
    <AppShell>
      <main className="relative max-w-7xl mx-auto px-6 py-16">
        {/* ─── Hero ─── */}
        <header className="relative mb-12">
          <span
            aria-hidden
            className="kanji-mark text-[26rem] -top-32 -right-10 hidden md:block"
          >
            目
          </span>
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
            <p className="micro-tight mt-5 reveal" style={{ "--i": 3 }}>
              {t("browse.total", { n: total })}
            </p>
          ) : null}
        </header>

        {/* ─── Search + type filter ─── */}
        <section className="mb-10 reveal" style={{ "--i": 4 }}>
          <div className="relative">
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
            className="flex flex-wrap items-center gap-2 mt-5"
          >
            <ChipButton
              active={type === ""}
              onClick={() => setType("")}
              label={t("browse.filter_all")}
            />
            {TYPES.map((tt) => (
              <ChipButton
                key={tt}
                active={type === tt}
                onClick={() => setType(tt)}
                label={t(`type.${tt}`)}
              />
            ))}
          </nav>
        </section>

        {/* ─── Grid ─── */}
        {figures.isLoading ? (
          <p className="text-center text-[var(--color-ivoire-soft)] py-12">…</p>
        ) : total === 0 ? (
          <p className="text-center text-[var(--color-ivoire-soft)] py-16 italic">
            {t("browse.empty")}
          </p>
        ) : (
          <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {figures.data.map((f, i) => (
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
                  manufacturer={null}
                  imageUrl={resolveFigureCover(f)}
                  scale={f.scale}
                  heightMm={f.height_mm}
                  blurImage={
                    f.is_nsfw &&
                    (me.data?.user?.nsfw_visibility ?? "hide") === "blur"
                  }
                  badge={(() => {
                    const phase = preorderPhaseFromFigure(f);
                    const label = preorderBadgeLabel(phase, t);
                    return label ? { label, tone: "preorder" } : null;
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

function ChipButton({ active, onClick, label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1.5 text-[10px] uppercase tracking-[0.22em] border transition-colors ${
        active
          ? "border-[var(--color-or)] bg-[var(--color-or)]/10 text-[var(--color-or)]"
          : "border-[var(--color-or)]/20 text-[var(--color-ivoire-soft)] hover:text-[var(--color-or-pale)] hover:border-[var(--color-or)]/50"
      }`}
    >
      {label}
    </button>
  );
}

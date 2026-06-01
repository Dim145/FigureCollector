import { Link, Navigate } from "react-router-dom";
import { useT } from "../i18n/index.jsx";
import { useMe } from "../hooks/useMe.js";
import { useMangaLink, useCrossings } from "../hooks/useMangaLink.js";
import AppShell from "../components/AppShell.jsx";
import Reveal from "../components/motion/Reveal.jsx";

const INDIGO = "var(--color-indigo)";
const INDIGO_BRIGHT = "var(--color-indigo-bright)";

/**
 * 双 Croisements (Lot 8) — the MangaCollector cross-link discovery page.
 *
 * Two columns, both keyed on the series' shared `mal_id`:
 *   · LEFT  — "Figures from series you read": the user owns the manga but not
 *             (yet) the figure. A nudge toward the wishlist.            (reading[])
 *   · RIGHT — "Series in both": manga + figure — the heart of a collection. (dual[])
 *
 * Needs a manga link to mean anything; unlinked users get an empty state that
 * points at Settings.
 */
export default function CroisementsPage() {
  const t = useT();
  const me = useMe();
  const link = useMangaLink();
  const connected = !!link.data?.connected;
  const crossings = useCrossings(connected);

  if (me.isLoading) return null;
  if (!me.data?.authenticated) return <Navigate to="/login" replace />;

  const reading = crossings.data?.reading ?? [];
  const dual = crossings.data?.dual ?? [];

  return (
    <AppShell>
      <main className="relative max-w-6xl mx-auto px-6 py-12 sm:py-16">
        <span
          aria-hidden
          className="kanji-mark text-[18rem] sm:text-[24rem] -top-20 right-0 select-none"
          style={{ color: `color-mix(in oklab, ${INDIGO} 9%, transparent)` }}
        >
          双
        </span>

        <Reveal as="header" className="relative mb-8" y={20}>
          <p className="micro" style={{ color: INDIGO_BRIGHT }}>
            {t("manga.croisements.eyebrow")}
          </p>
          <h1 className="display text-4xl sm:text-5xl md:text-6xl mt-2 text-[var(--color-ivoire)] leading-[0.98]">
            {t("manga.croisements.title")}
          </h1>
          <div
            className="w-16 mt-4 h-px"
            style={{
              background: `linear-gradient(to right, ${INDIGO}, transparent)`,
            }}
          />
          <p className="mt-4 max-w-2xl leading-relaxed text-[var(--color-ivoire-soft)]">
            {t("manga.croisements.subtitle")}
          </p>
        </Reveal>

        {!connected ? (
          <NotLinked t={t} />
        ) : crossings.isLoading ? (
          <p className="relative text-center text-[var(--color-ivoire-soft)] py-12">
            …
          </p>
        ) : (
          <div className="relative grid md:grid-cols-2 gap-6">
            {/* ── LEFT: figures from series you read ── */}
            <Reveal as="section" className="manga-panel" delay={0} y={20}>
              <h2 className="display text-[1.35rem] text-[var(--color-ivoire)]">
                {t("manga.croisements.reading.title")}
              </h2>
              <span className="micro block mb-3">
                {t("manga.croisements.reading.sub")}
              </span>
              {reading.length === 0 ? (
                <p className="text-[13px] text-[var(--color-ivoire-soft)] py-6">
                  {t("manga.croisements.reading.empty")}
                </p>
              ) : (
                <ul>
                  {reading.map((r) => (
                    <ReadingRow key={r.mal_id} r={r} t={t} />
                  ))}
                </ul>
              )}
              <p className="mt-4 text-[11px] text-[var(--color-ivoire-soft)] leading-relaxed">
                {t("manga.croisements.reading.cap")}
              </p>
            </Reveal>

            {/* ── RIGHT: series in both ── */}
            <Reveal as="section" className="manga-panel" delay={0.06} y={20}>
              <h2 className="display text-[1.35rem] text-[var(--color-ivoire)]">
                {t("manga.croisements.dual.title")}
              </h2>
              <span className="micro block mb-3">
                {t("manga.croisements.dual.sub")}
              </span>
              {dual.length === 0 ? (
                <p className="text-[13px] text-[var(--color-ivoire-soft)] py-6">
                  {t("manga.croisements.dual.empty")}
                </p>
              ) : (
                <ul>
                  {dual.map((d) => (
                    <DualRow key={d.mal_id} d={d} t={t} />
                  ))}
                </ul>
              )}
              <p className="mt-4 text-[11px] text-[var(--color-ivoire-soft)] leading-relaxed">
                {t("manga.croisements.dual.cap")}
              </p>
            </Reveal>
          </div>
        )}
      </main>

      <PanelStyle />
    </AppShell>
  );
}

// ── Left column row — a figure you don't own from a series you read ──────────
function ReadingRow({ r, t }) {
  const pct = clampPct(r.read_percent);
  return (
    <li className="flex items-center gap-3 py-3 border-b border-[color-mix(in_oklab,var(--color-or)_10%,transparent)] last:border-b-0">
      {/* figure thumb (catalogue image, or a kanji fallback by type) */}
      <Thumb image={r.image} kanji={kanjiForType(r.figure_type)} />
      <span
        aria-hidden
        className="ja shrink-0 text-base"
        style={{ color: `color-mix(in oklab, ${INDIGO} 60%, transparent)` }}
      >
        連
      </span>
      {/* manga side glyph */}
      <Thumb manga kanji="漫" />
      <div className="flex-1 min-w-0">
        <Link
          to={`/figures/${r.slug}`}
          className="display text-[1.15rem] text-[var(--color-ivoire)] block leading-[1.15] truncate hover:text-[var(--color-or-pale)] transition-colors"
        >
          {r.name}
        </Link>
        <span className="font-mono text-[10.5px] text-[var(--color-ivoire-soft)] truncate block">
          {r.series_name || r.manga_name}
        </span>
      </div>
      <Pill tone="manga">
        📖{" "}
        {pct >= 100
          ? t("manga.pill.read_full")
          : t("manga.pill.vol", { owned: r.volumes_owned ?? 0, total: r.volumes ?? 0 })}
      </Pill>
    </li>
  );
}

// ── Right column row — a series present on both shelves ──────────────────────
function DualRow({ d, t }) {
  const pct = clampPct(d.read_percent);
  return (
    <li className="flex items-center gap-3 py-3 border-b border-[color-mix(in_oklab,var(--color-or)_10%,transparent)] last:border-b-0">
      <Thumb kanji="彫" />
      <span aria-hidden className="ja shrink-0 text-base text-[var(--color-or-pale)]">
        ⇄
      </span>
      <Thumb manga kanji="漫" />
      <div className="flex-1 min-w-0">
        <b className="display text-[1.15rem] text-[var(--color-ivoire)] block leading-[1.15] truncate not-italic font-normal">
          {d.series_name || d.manga_name}
        </b>
        <span className="font-mono text-[10.5px] text-[var(--color-ivoire-soft)] truncate block">
          {d.manga_name}
        </span>
      </div>
      <div className="flex flex-col gap-1 items-end shrink-0">
        <Pill tone="manga">📖 {t("manga.pill.percent", { pct })}</Pill>
        <Pill tone="figure">
          🎏 {t("manga.pill.figures", { n: d.figure_count ?? 0 })}
        </Pill>
      </div>
    </li>
  );
}

// ── Small bits ───────────────────────────────────────────────────────────────

/** A 38×48 thumbnail well. Shows the catalogue image when present, else a
 *  kanji glyph (indigo-framed for the manga side). */
function Thumb({ image, kanji, manga = false }) {
  if (image) {
    return (
      <span
        className="shrink-0 w-[38px] h-[48px] bg-[var(--color-noir-deep)] border border-[color-mix(in_oklab,var(--color-or)_16%,transparent)] bg-cover bg-center"
        style={{ backgroundImage: `url(${cssUrl(image)})` }}
        aria-hidden
      />
    );
  }
  return (
    <span
      aria-hidden
      className="ja shrink-0 grid place-items-center w-[38px] h-[48px] text-[1.2rem] bg-[var(--color-noir-deep)]"
      style={
        manga
          ? {
              border: `1px solid color-mix(in oklab, ${INDIGO} 40%, transparent)`,
              color: INDIGO_BRIGHT,
            }
          : {
              border: "1px solid color-mix(in oklab, var(--color-or) 16%, transparent)",
              color: "color-mix(in oklab, var(--color-or) 45%, transparent)",
            }
      }
    >
      {kanji}
    </span>
  );
}

function Pill({ tone, children }) {
  const style =
    tone === "manga"
      ? { color: INDIGO_BRIGHT, borderColor: `color-mix(in oklab, ${INDIGO} 45%, transparent)` }
      : {
          color: "var(--color-or-pale)",
          borderColor: "color-mix(in oklab, var(--color-or) 40%, transparent)",
        };
  return (
    <span
      className="text-[9px] uppercase tracking-[0.1em] px-[0.5em] py-[0.18em] border whitespace-nowrap"
      style={style}
    >
      {children}
    </span>
  );
}

function NotLinked({ t }) {
  return (
    <Reveal
      as="div"
      className="relative text-center max-w-md mx-auto py-16"
      y={16}
    >
      <span aria-hidden className="ja text-5xl" style={{ color: INDIGO_BRIGHT }}>
        漫
      </span>
      <h2 className="display text-2xl text-[var(--color-ivoire)] mt-4">
        {t("manga.croisements.unlinked.title")}
      </h2>
      <p className="mt-3 text-[var(--color-ivoire-soft)] leading-relaxed">
        {t("manga.croisements.unlinked.body")}
      </p>
      <Link
        to="/settings"
        className="inline-flex items-center gap-2 mt-6 px-5 py-3 text-[11px] uppercase tracking-[0.2em] text-[var(--color-ivoire)]"
        style={{
          background: `color-mix(in oklab, ${INDIGO} 18%, transparent)`,
          border: `1px solid ${INDIGO}`,
        }}
      >
        {t("manga.croisements.unlinked.cta")}
      </Link>
    </Reveal>
  );
}

/** Shared panel chrome — indigo-tinted border like the maquette's `.panel.manga`. */
function PanelStyle() {
  return (
    <style>{`
      .manga-panel {
        border: 1px solid color-mix(in oklab, ${INDIGO} 28%, transparent);
        background: color-mix(in oklab, var(--color-noir-soft) 62%, transparent);
        padding: 1.4rem 1.5rem;
      }
    `}</style>
  );
}

function clampPct(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/** Sanitize a URL for use inside a CSS `url(...)` so a stray `)` / quote in a
 *  storage path can't break out of the declaration. */
function cssUrl(u) {
  return String(u).replace(/["'()\\]/g, encodeURIComponent);
}

// Figure-type → kanji glyph (matches the convention used across the catalogue
// surfaces — see FigureDetailPage / FigureCard).
function kanjiForType(type) {
  switch (type) {
    case "nendoroid":  return "童";
    case "scale":      return "像";
    case "figma":      return "動";
    case "prize":      return "賞";
    case "trading":    return "交";
    case "statue":     return "彫";
    case "plamo":      return "組";
    case "bishoujo":   return "美";
    case "dakimakura": return "枕";
    default:           return "玩";
  }
}

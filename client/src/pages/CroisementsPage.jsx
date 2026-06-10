import { useMemo } from "react";
import { Link, Navigate } from "react-router-dom";
import { useT } from "../i18n/index.jsx";
import { useMe } from "../hooks/useMe.js";
import { useMangaLink, useCrossings } from "../hooks/useMangaLink.js";
import AccentTitle from "../components/AccentTitle.jsx";
import AppShell from "../components/AppShell.jsx";
import Button from "../components/Button.jsx";
import Card from "../components/Card.jsx";
import StatCard from "../components/StatCard.jsx";
import FigureCard from "../components/FigureCard.jsx";
import Reveal from "../components/motion/Reveal.jsx";

/**
 * 交 Croisements (Lot 8) — the MangaCollector cross-link discovery page,
 * redrawn to Direction A ("Shōjo-Noir").
 *
 * Two relational lists, both keyed on the series' shared `mal_id`:
 *   · LEFT  — "Figures from series you read": you own the manga but not (yet)
 *             the figure. A nudge toward the wishlist. Rendered as designed
 *             FigureCards (the catalogue specimen) bridged to the manga side.
 *             Hanko-red carries the "discover / add" energy here.   (reading[])
 *   · RIGHT — "Series in both": manga + figure — the heart of a collection.
 *             A series ledger; gold marks the value (the figures you own of
 *             that series).                                             (dual[])
 *
 * Palette stays on-direction (mirroring ComparePage, the sibling crossover
 * page): hanko-red is the single hot accent (the reading nudge, the active CTA),
 * gold marks value/overlap (the dual ledger), ivoire keeps chrome quiet. No
 * indigo, no animated mesh — a static feathered wash, hairlines, kanji marks,
 * the shared Reveal motion.
 *
 * Needs an APPROVED manga link to mean anything; unlinked / pending / revoked
 * users get an editorial empty-state Card that points at Settings.
 */
export default function CroisementsPage() {
  const t = useT();
  const me = useMe();
  const link = useMangaLink();
  const connected = !!link.data?.connected;
  const status = link.data?.status ?? null;
  // Crossings only resolve for an APPROVED server; pending/revoked links get a
  // status banner instead of a (necessarily empty) result.
  const active = status === "approved";
  const crossings = useCrossings(active);

  const reading = useMemo(() => crossings.data?.reading ?? [], [crossings.data]);
  const dual = useMemo(() => crossings.data?.dual ?? [], [crossings.data]);

  // Figurine-metric strip — derived from the two crossing lists + the linked
  // library profile. Counts only (relations, pieces, series, volumes), so they
  // stay ivoire/red; no value/cote rides in this payload. Computed before the
  // early returns so the hook order stays stable across auth state.
  const metrics = useMemo(() => {
    const pieces = dual.reduce((n, d) => n + (d.figure_count ?? 0), 0);
    const profile = link.data?.profile ?? null;
    return {
      reading: reading.length,
      dual: dual.length,
      pieces,
      seriesRead: profile?.series_count ?? null,
      volumesOwned: profile?.volumes_owned ?? null,
    };
  }, [reading, dual, link.data]);

  if (me.isLoading) return null;
  if (!me.data?.authenticated) return <Navigate to="/login" replace />;

  const showStrip = active && !crossings.isLoading && (reading.length > 0 || dual.length > 0);

  return (
    <AppShell>
      <main className="relative max-w-6xl mx-auto px-6 py-12 sm:py-16">
        {/* Localized hero colour-wash — hanko-red on the left (the reading
            nudge), gold meeting toward the right (the dual ledger / value), a
            quiet warm fade between. Static + feathered (GPU-light,
            reduced-motion safe). */}
        <HeroWash />

        {/* ─── Editorial header ─── */}
        <header className="relative mb-10">
          <span
            aria-hidden
            className="kanji-mark text-[18rem] sm:text-[24rem] -top-24 -right-8 hidden md:block select-none"
          >
            交
          </span>

          <Reveal as="p" className="micro flex items-center gap-2.5" y={16}>
            <span aria-hidden className="w-1 h-1 bg-[var(--color-laque-bright)] rotate-45" />
            {t("croisements.kicker", { default: "SYNERGIE" })}
            <span aria-hidden className="ja not-italic text-[var(--color-or)]">交</span>
            {t("croisements.kicker_label", { default: "DEUX VITRINES" })}
          </Reveal>
          <Reveal
            as="h1"
            delay={0.05}
            y={20}
            className="display text-5xl sm:text-6xl md:text-7xl mt-3 text-[var(--color-ivoire)] leading-[0.95]"
          >
            <AccentTitle text={t("manga.croisements.title")} />
          </Reveal>
          <Reveal as="div" delay={0.1} className="gold-rule w-24 mt-6" />
          <Reveal
            as="p"
            delay={0.14}
            className="display-italic text-[var(--color-or)] text-lg mt-5 max-w-2xl"
          >
            {t("manga.croisements.subtitle")}
          </Reveal>
        </header>

        {/* ─── Figurine-metric strip (only when there's something to count) ─── */}
        {showStrip ? (
          <Reveal
            as="div"
            delay={0.06}
            className="relative grid grid-cols-2 lg:grid-cols-4 gap-3 mb-12"
          >
            <StatCard
              label={t("croisements.stat.dual", { default: "Séries en double" })}
              value={metrics.dual}
              sub={t("croisements.stat.dual_sub", { default: "manga + figurine" })}
              tone="gold"
            />
            <StatCard
              label={t("croisements.stat.pieces", { default: "Pièces croisées" })}
              value={metrics.pieces}
              sub={t("croisements.stat.pieces_sub", { default: "figurines des séries en double" })}
              tone="gold"
            />
            <StatCard
              label={t("croisements.stat.reading", { default: "À découvrir" })}
              value={metrics.reading}
              sub={t("croisements.stat.reading_sub", { default: "figurines de séries que tu lis" })}
              tone="red"
            />
            <StatCard
              label={t("croisements.stat.shelf", { default: "Étagère manga" })}
              value={metrics.seriesRead ?? "—"}
              sub={
                metrics.volumesOwned != null
                  ? t("croisements.stat.shelf_sub", {
                      n: metrics.volumesOwned,
                      default: `${metrics.volumesOwned} tomes`,
                    })
                  : t("croisements.stat.shelf_sub_series", { default: "séries reliées" })
              }
            />
          </Reveal>
        ) : null}

        {!connected ? (
          <NotLinked t={t} />
        ) : !active ? (
          <NotActive t={t} status={status} reason={link.data?.revoked_reason} />
        ) : crossings.isLoading ? (
          <p
            role="status"
            aria-live="polite"
            className="relative text-center text-[var(--color-ivoire-soft)] py-16"
          >
            …
          </p>
        ) : (
          <div className="relative grid lg:grid-cols-2 gap-8 lg:gap-10">
            {/* ── LEFT: figures from series you read — the discovery nudge ── */}
            <CrossingColumn
              kanji="連"
              accent="var(--color-laque-bright)"
              eyebrow={t("manga.croisements.reading.sub")}
              title={t("manga.croisements.reading.title")}
              count={reading.length}
              caption={t("manga.croisements.reading.cap")}
              empty={t("manga.croisements.reading.empty")}
              isEmpty={reading.length === 0}
              delay={0}
            >
              <ul className="grid sm:grid-cols-2 gap-5">
                {reading.map((r, i) => (
                  <ReadingCard key={r.mal_id} r={r} t={t} i={i} />
                ))}
              </ul>
            </CrossingColumn>

            {/* ── RIGHT: series present on both shelves — the value ledger ── */}
            <CrossingColumn
              kanji="双"
              accent="var(--color-or)"
              eyebrow={t("manga.croisements.dual.sub")}
              title={t("manga.croisements.dual.title")}
              count={dual.length}
              caption={t("manga.croisements.dual.cap")}
              empty={t("manga.croisements.dual.empty")}
              isEmpty={dual.length === 0}
              delay={0.06}
            >
              <Card as="ul" className="divide-y divide-[color-mix(in_oklab,var(--color-or)_12%,transparent)]">
                {dual.map((d, i) => (
                  <DualRow key={d.mal_id} d={d} t={t} i={i} />
                ))}
              </Card>
            </CrossingColumn>
          </div>
        )}
      </main>
    </AppShell>
  );
}

/** color-mix helper — keep accent translucency in oklab, theme-var safe. */
function mix(accent, pct) {
  return `color-mix(in oklab, ${accent} ${pct}%, transparent)`;
}

/**
 * A crossing column: an accent-tinted editorial header (kanji + eyebrow + a
 * count chip), a gold-rule divider, the list (cards / ledger), then a quiet
 * footnote. Empty lists collapse to a watermark Card.
 */
function CrossingColumn({
  kanji,
  accent,
  eyebrow,
  title,
  count,
  caption,
  empty,
  isEmpty,
  children,
  delay = 0,
}) {
  return (
    <Reveal as="section" delay={delay} y={24} className="relative">
      <header className="mb-4">
        <p className="micro flex items-center gap-2" style={{ color: mix(accent, 80) }}>
          <span className="ja not-italic text-base leading-none" aria-hidden style={{ color: accent }}>
            {kanji}
          </span>
          {eyebrow}
        </p>
        <div className="flex items-baseline justify-between gap-3 mt-2">
          <h2 className="display text-2xl sm:text-[1.75rem] text-[var(--color-ivoire)] leading-tight">
            {title}
          </h2>
          <span
            className="font-mono text-xs px-2 py-0.5 tabular-nums shrink-0"
            style={{ color: accent, background: mix(accent, 12), border: `1px solid ${mix(accent, 32)}` }}
          >
            {count}
          </span>
        </div>
        <div
          className="h-px mt-4"
          style={{ background: `linear-gradient(90deg, ${mix(accent, 60)}, transparent)` }}
        />
      </header>

      {isEmpty ? (
        <Card className="p-8 text-center relative overflow-hidden">
          <span
            aria-hidden
            className="ja absolute -top-4 -right-3 text-[7rem] leading-none text-[var(--color-or)]/10 select-none"
          >
            {kanji}
          </span>
          <p className="relative text-[var(--color-ivoire-soft)] italic leading-relaxed">{empty}</p>
        </Card>
      ) : (
        <>
          {children}
          <p className="mt-4 text-[11px] text-[var(--color-ivoire-soft)]/70 leading-relaxed">{caption}</p>
        </>
      )}
    </Reveal>
  );
}

/**
 * Left-column entry — a figure you don't own from a series you read. The
 * catalogue specimen (FigureCard) is the hero; a manga-side ledger strip below
 * names the matched series and your reading progress, with a 連 bridge mark.
 */
function ReadingCard({ r, t, i }) {
  const pct = clampPct(r.read_percent);
  const progress =
    pct >= 100
      ? t("manga.pill.read_full")
      : t("manga.pill.vol", { owned: r.volumes_owned ?? 0, total: r.volumes ?? 0 });
  return (
    <Reveal as="li" delay={Math.min(i, 7) * 0.04} y={18} className="flex flex-col">
      <FigureCard
        figureId={r.id}
        href={`/figures/${r.id}`}
        name={r.name}
        type={r.figure_type}
        imageUrl={r.image}
      />
      {/* Manga-side ledger strip — the crossing's other half. */}
      <div
        className="mt-2 flex items-center gap-2 px-3 py-2"
        style={{
          background: mix("var(--color-laque)", 7),
          borderLeft: `2px solid ${mix("var(--color-laque-bright)", 65)}`,
        }}
      >
        <span aria-hidden className="ja text-sm leading-none text-[var(--color-laque-bright)]">
          連
        </span>
        <span className="font-mono text-[10.5px] text-[var(--color-ivoire-soft)] truncate flex-1 min-w-0">
          {r.series_name || r.manga_name}
        </span>
        <Pill accent="var(--color-laque-bright)">{progress}</Pill>
      </div>
    </Reveal>
  );
}

/**
 * Right-column row — a series present on both shelves, in a gold value ledger.
 * 双 (pair) bridges the manga and figure sides; the figure count is the value
 * note (gold figural), the reading percent rides alongside.
 */
function DualRow({ d, t, i }) {
  const pct = clampPct(d.read_percent);
  const figures = d.figure_count ?? 0;
  return (
    <Reveal as="li" delay={Math.min(i, 7) * 0.04} y={14} className="flex items-center gap-3 px-4 py-3.5">
      <span aria-hidden className="ja shrink-0 text-base text-[var(--color-or)] leading-none">
        双
      </span>
      <div className="flex-1 min-w-0">
        <b className="display text-[1.1rem] text-[var(--color-ivoire)] block leading-[1.2] truncate not-italic font-normal">
          {d.series_name || d.manga_name}
        </b>
        <span className="font-mono text-[10.5px] text-[var(--color-ivoire-soft)]/80 truncate block">
          {d.manga_name}
        </span>
      </div>
      <div className="flex flex-col items-end gap-1.5 shrink-0">
        <span className="flex items-baseline gap-1.5" title={t("manga.croisements.dual.sub")}>
          <span className="figural text-2xl leading-none text-[var(--color-or)]">{figures}</span>
          <span className="micro-tight text-[var(--color-or-pale)]/70">
            {t("croisements.dual.pieces", { default: "pièces" })}
          </span>
        </span>
        <Pill accent="var(--color-or)">{t("manga.pill.percent", { pct })}</Pill>
      </div>
    </Reveal>
  );
}

// ── Small bits ───────────────────────────────────────────────────────────────

/** A hairline accent chip — uppercase, tracked, accent-tinted border + text. */
function Pill({ accent, children }) {
  return (
    <span
      className="text-[9px] uppercase tracking-[0.12em] px-[0.5em] py-[0.18em] whitespace-nowrap"
      style={{ color: accent, borderColor: mix(accent, 42), borderWidth: 1, borderStyle: "solid" }}
    >
      {children}
    </span>
  );
}

/** Editorial empty state — a Card with a faint kanji watermark, an accent
 *  eyebrow, the message, a gold-rule, and a red CTA into Settings. Shared shape
 *  for both the not-linked and the not-active (pending/revoked) cases. */
function EmptyCard({ kanji, accent, eyebrow, title, body, cta }) {
  return (
    <Reveal as="div" className="relative max-w-xl mx-auto" y={16}>
      <Card className="p-10 sm:p-12 text-center relative overflow-hidden frame-corners">
        <span
          aria-hidden
          className="kanji-mark text-[13rem] -top-10 -right-6 select-none"
          style={{ color: mix(accent, 12) }}
        >
          {kanji}
        </span>
        <p className="micro relative flex items-center justify-center gap-2" style={{ color: mix(accent, 85) }}>
          <span aria-hidden className="w-1 h-1 rotate-45" style={{ background: accent }} />
          {eyebrow}
        </p>
        <h2 className="display text-2xl sm:text-3xl mt-3 text-[var(--color-ivoire)] relative leading-tight">
          {title}
        </h2>
        <p className="mt-4 text-[var(--color-ivoire-soft)] leading-relaxed relative max-w-md mx-auto">
          {body}
        </p>
        <div className="gold-rule mx-auto w-20 my-8" />
        <div className="relative flex justify-center">
          <Link to="/settings">
            <Button variant="primary">{cta}</Button>
          </Link>
        </div>
      </Card>
    </Reveal>
  );
}

function NotLinked({ t }) {
  return (
    <EmptyCard
      kanji="交"
      accent="var(--color-laque-bright)"
      eyebrow={t("croisements.unlinked.eyebrow", { default: "AUCUN LIEN" })}
      title={t("manga.croisements.unlinked.title")}
      body={t("manga.croisements.unlinked.body")}
      cta={t("manga.croisements.unlinked.cta")}
    />
  );
}

/** Linked, but the server is pending or revoked — features are dormant. */
function NotActive({ t, status, reason }) {
  const revoked = status === "revoked";
  // Revoked = error → hanko-red; pending = waiting → gold. Both within the
  // Direction-A palette (no indigo).
  const accent = revoked ? "var(--color-laque-bright)" : "var(--color-or)";
  return (
    <EmptyCard
      kanji={revoked ? "禁" : "待"}
      accent={accent}
      eyebrow={
        revoked
          ? t("croisements.revoked.eyebrow", { default: "SERVEUR RÉVOQUÉ" })
          : t("croisements.pending.eyebrow", { default: "EN ATTENTE" })
      }
      title={revoked ? t("manga.croisements.revoked.title") : t("manga.croisements.pending.title")}
      body={
        revoked
          ? reason
            ? t("manga.croisements.revoked.body_reason", { reason })
            : t("manga.croisements.revoked.body")
          : t("manga.croisements.pending.body")
      }
      cta={t("manga.croisements.unlinked.cta")}
    />
  );
}

/**
 * Localized hero colour-wash — hanko-red on the left (the reading nudge), gold
 * meeting toward the right (the dual value ledger), a faint warm fade between.
 * Static (no breathe — GPU-light); edges feathered so the gradients fade
 * instead of hard-cutting at the content column.
 */
function HeroWash() {
  const wrap = {
    position: "absolute",
    top: "-3rem",
    left: "-3rem",
    right: "-3rem",
    height: "42vh",
    pointerEvents: "none",
    zIndex: 0,
    WebkitMaskImage:
      "linear-gradient(to right, transparent 0, #000 8%, #000 92%, transparent 100%)",
    maskImage:
      "linear-gradient(to right, transparent 0, #000 8%, #000 92%, transparent 100%)",
  };
  const base = { position: "absolute", inset: 0 };
  const layerRead = {
    background: `radial-gradient(48% 64% at 16% 4%, ${mix("var(--color-laque)", 15)}, transparent 70%)`,
  };
  const layerDual = {
    background: `radial-gradient(48% 64% at 84% 4%, ${mix("var(--color-or)", 15)}, transparent 70%)`,
  };
  return (
    <div aria-hidden style={wrap}>
      <span style={{ ...base, ...layerRead, opacity: 0.85 }} />
      <span style={{ ...base, ...layerDual, opacity: 0.85 }} />
    </div>
  );
}

function clampPct(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

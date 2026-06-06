import { useMemo } from "react";
import { Navigate, useParams } from "react-router-dom";
import { useT } from "../i18n/index.jsx";
import { useMe } from "../hooks/useMe.js";
import { useCompare } from "../hooks/useProfile.js";
import AccentTitle from "../components/AccentTitle.jsx";
import AppShell from "../components/AppShell.jsx";
import Card from "../components/Card.jsx";
import StatCard from "../components/StatCard.jsx";
import FigureCard from "../components/FigureCard.jsx";
import Reveal from "../components/motion/Reveal.jsx";

/**
 * Direction A — "Le croisement".
 *
 * A head-to-head reading-room: an editorial header, a comparative StatCard
 * strip (figurine metrics — pièces de part et d'autre, pièces en commun,
 * affinité, fabricants partagés), then a designed *vs* spread — your shelf on
 * the left, theirs on the right, the shared count meeting on a central 対
 * divider. Below, three Card-framed buckets list the actual specimens.
 *
 * Palette stays on-direction: hanko-red is *your* side (the only hot accent),
 * gold marks the shared pieces (value/overlap), ivoire keeps their side quiet.
 * No jade/indigo, no animated mesh — static feathered wash, hairlines, Reveal.
 */
export default function ComparePage() {
  const { slug } = useParams();
  const t = useT();
  const me = useMe();
  const compare = useCompare(slug);

  // Comparative metrics — derived from the three buckets the API returns.
  // (CompareEntry carries figure_type + manufacturer_name; no value/cote in
  // the payload, so we surface piece/maker/type overlap — the figurine
  // metrics the playbook allows. No manga "completion".)
  const metrics = useMemo(() => {
    const d = compare.data;
    if (!d) return null;
    const { common, yours_only, theirs_only } = d;
    const yoursTotal = common.length + yours_only.length;
    const theirsTotal = common.length + theirs_only.length;
    const union = common.length + yours_only.length + theirs_only.length;
    const affinity = union > 0 ? Math.round((common.length / union) * 100) : 0;

    const makersOf = (lists) => {
      const s = new Set();
      for (const list of lists) {
        for (const e of list) {
          if (e.manufacturer_name) s.add(e.manufacturer_name);
        }
      }
      return s;
    };
    const yoursMakers = makersOf([common, yours_only]);
    const theirsMakers = makersOf([common, theirs_only]);
    let sharedMakers = 0;
    for (const m of yoursMakers) if (theirsMakers.has(m)) sharedMakers += 1;

    const typesOf = (lists) => {
      const s = new Set();
      for (const list of lists) for (const e of list) if (e.figure_type) s.add(e.figure_type);
      return s;
    };
    const yoursTypes = typesOf([common, yours_only]);
    const theirsTypes = typesOf([common, theirs_only]);
    let sharedTypes = 0;
    for (const ty of yoursTypes) if (theirsTypes.has(ty)) sharedTypes += 1;

    return {
      yoursTotal,
      theirsTotal,
      common: common.length,
      yoursOnly: yours_only.length,
      theirsOnly: theirs_only.length,
      affinity,
      sharedMakers,
      sharedTypes,
    };
  }, [compare.data]);

  if (me.isLoading) return null;
  if (!me.data?.authenticated) return <Navigate to="/login" replace />;
  if (compare.isLoading) {
    return (
      <AppShell>
        <div role="status" aria-live="polite" className="text-center py-12 text-[var(--color-ivoire-soft)]">…</div>
      </AppShell>
    );
  }
  if (compare.error || !compare.data) {
    return (
      <AppShell>
        <main className="max-w-md mx-auto px-6 py-16 text-center">
          <p className="display text-2xl text-[var(--color-ivoire)]">404</p>
          <p className="mt-2 text-[var(--color-ivoire-soft)]">{t("error.unknown")}</p>
        </main>
      </AppShell>
    );
  }

  const { them, common, yours_only, theirs_only } = compare.data;
  const youName =
    me.data.user?.display_name || me.data.user?.username || t("follow.you", { default: "Vous" });

  return (
    <AppShell>
      <main className="relative max-w-6xl mx-auto px-6 py-12 sm:py-16">
        {/* Localized hero colour-wash — hanko-red on your side (left), gold
            meeting in the middle for the shared pieces, a quiet fade on theirs.
            Static + feathered (GPU-light, reduced-motion safe). */}
        <HeroWash />

        {/* ─── Editorial header ─── */}
        <header className="relative mb-10">
          <span
            aria-hidden
            className="kanji-mark text-[24rem] -top-28 -right-8 hidden md:block select-none"
          >
            対
          </span>

          <Reveal as="p" className="micro flex items-center gap-2.5" y={16}>
            <span aria-hidden className="w-1 h-1 bg-[var(--color-laque-bright)] rotate-45" />
            {t("compare.kicker", { default: "CROISEMENT" })} · 蒐 · @{them.username}
          </Reveal>
          <Reveal
            as="h1"
            delay={0.05}
            y={20}
            className="display text-4xl sm:text-5xl md:text-6xl mt-3 text-[var(--color-ivoire)] leading-[0.98]"
          >
            <AccentTitle text={t("compare.title", { name: them.display_name })} />
          </Reveal>
          <Reveal as="div" delay={0.1} className="gold-rule w-24 mt-6" />
          <Reveal
            as="p"
            delay={0.14}
            className="display-italic text-[var(--color-or)] text-lg mt-5 max-w-xl"
          >
            {t("compare.lede", {
              default: "Deux vitrines mises en regard — ce que vous partagez, ce qui vous distingue.",
            })}
          </Reveal>
        </header>

        {/* ─── Comparative stat strip ─── */}
        {metrics ? (
          <Reveal
            as="div"
            delay={0.06}
            className="relative grid grid-cols-2 lg:grid-cols-4 gap-3 mb-12"
          >
            <StatCard
              label={t("compare.stat.common", { default: "Pièces en commun" })}
              value={metrics.common}
              sub={t("compare.stat.affinity_sub", {
                pct: metrics.affinity,
                default: `${metrics.affinity}% d'affinité`,
              })}
              tone="gold"
            />
            <StatCard
              label={t("compare.stat.yours", { default: "Vos pièces" })}
              value={metrics.yoursTotal}
              sub={t("compare.stat.only_sub", {
                n: metrics.yoursOnly,
                default: `${metrics.yoursOnly} à vous seul·e`,
              })}
              tone="red"
            />
            <StatCard
              label={t("compare.stat.theirs", { name: them.display_name, default: "Ses pièces" })}
              value={metrics.theirsTotal}
              sub={t("compare.stat.only_sub", {
                n: metrics.theirsOnly,
                default: `${metrics.theirsOnly} à elle/lui seul·e`,
              })}
            />
            <StatCard
              label={t("compare.stat.shared_makers", { default: "Fabricants partagés" })}
              value={metrics.sharedMakers}
              sub={t("compare.stat.shared_types_sub", {
                n: metrics.sharedTypes,
                default: `${metrics.sharedTypes} types en commun`,
              })}
            />
          </Reveal>
        ) : null}

        {/* ─── The "vs" spread — head-to-head, shared count on the spine ─── */}
        {metrics ? (
          <Reveal as="section" delay={0.08} className="relative mb-14">
            <Card className="p-6 sm:p-8">
              <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4 sm:gap-8">
                <ShelfSide
                  align="right"
                  eyebrow={t("compare.side.you", { default: "Votre vitrine" })}
                  name={youName}
                  total={metrics.yoursTotal}
                  only={metrics.yoursOnly}
                  onlyLabel={t("compare.bucket.yours_only")}
                  accent="var(--color-laque-bright)"
                />
                <VsSpine common={metrics.common} t={t} />
                <ShelfSide
                  align="left"
                  eyebrow={t("compare.side.them", { default: "Sa vitrine" })}
                  name={them.display_name}
                  total={metrics.theirsTotal}
                  only={metrics.theirsOnly}
                  onlyLabel={t("compare.bucket.theirs_only")}
                  accent="var(--color-ivoire)"
                />
              </div>
            </Card>
          </Reveal>
        ) : null}

        {/* ─── Buckets — the actual specimens ─── */}
        <div className="relative grid lg:grid-cols-3 gap-6 lg:gap-5">
          <Bucket
            title={t("compare.bucket.yours_only")}
            kanji="己"
            count={yours_only.length}
            entries={yours_only}
            accent="var(--color-laque-bright)"
            t={t}
            delay={0}
          />
          <Bucket
            title={t("compare.bucket.common")}
            kanji="共"
            count={common.length}
            entries={common}
            accent="var(--color-or)"
            t={t}
            delay={0.06}
          />
          <Bucket
            title={t("compare.bucket.theirs_only")}
            kanji="彼"
            count={theirs_only.length}
            entries={theirs_only}
            accent="var(--color-ivoire)"
            t={t}
            delay={0.12}
          />
        </div>
      </main>
    </AppShell>
  );
}

/** color-mix helper — keep accent translucency in oklab, theme-var safe. */
function mix(accent, pct) {
  return `color-mix(in oklab, ${accent} ${pct}%, transparent)`;
}

/**
 * One side of the head-to-head plaque: an eyebrow, the collector's name in
 * Fraunces, the total piece count (oldstyle figures), and the "only" tally.
 * `align` mirrors your side (right-aligned) against theirs (left-aligned) so
 * they read toward the central spine.
 */
function ShelfSide({ align, eyebrow, name, total, only, onlyLabel, accent }) {
  const right = align === "right";
  return (
    <div className={right ? "text-right" : "text-left"}>
      <p className="micro-tight" style={{ color: mix(accent, 75) }}>
        {eyebrow}
      </p>
      <p className="display text-lg sm:text-xl mt-1 text-[var(--color-ivoire)] truncate">
        {name}
      </p>
      <p
        className="figural text-4xl sm:text-5xl mt-2 leading-none"
        style={{ color: accent }}
      >
        {total}
      </p>
      <p className="micro-tight text-[var(--color-ivoire-soft)]/70 mt-2">
        {only} · {onlyLabel}
      </p>
    </div>
  );
}

/**
 * The central spine of the vs spread: a vertical hairline with the shared
 * count seated on a gold node and a 対 (facing/versus) mark — the point where
 * the two shelves meet.
 */
function VsSpine({ common, t }) {
  return (
    <div className="flex flex-col items-center justify-center px-1 sm:px-2">
      <span
        aria-hidden
        className="block w-px h-8 sm:h-10"
        style={{ background: `linear-gradient(${mix("var(--color-or)", 50)}, transparent)` }}
      />
      <span
        className="my-2 grid place-items-center w-14 h-14 sm:w-16 sm:h-16 rounded-full"
        style={{
          background: mix("var(--color-or)", 10),
          border: `1px solid ${mix("var(--color-or)", 40)}`,
          boxShadow: `inset 0 0 0 1px ${mix("var(--color-or)", 8)}`,
        }}
      >
        <span className="ja text-base leading-none text-[var(--color-or-pale)]" aria-hidden>
          対
        </span>
        <span className="figural text-xl leading-none text-[var(--color-or)] mt-0.5">
          {common}
        </span>
      </span>
      <span className="micro-tight text-[var(--color-or-pale)]/80">
        {t("compare.bucket.common")}
      </span>
      <span
        aria-hidden
        className="block w-px h-8 sm:h-10"
        style={{ background: `linear-gradient(transparent, ${mix("var(--color-or)", 50)})` }}
      />
    </div>
  );
}

/**
 * A bucket column: an accent-tinted header (count chip + kanji), a gold-rule
 * divider, then the FigureCard list. Empty buckets show a quiet Card with a
 * faint kanji watermark.
 */
function Bucket({ title, kanji, count, entries, accent, t, delay = 0 }) {
  return (
    <Reveal as="section" delay={delay} y={24} className="relative">
      <header className="flex items-baseline justify-between gap-3 mb-3">
        <h2 className="display text-2xl flex items-baseline gap-2.5" style={{ color: accent }}>
          <span className="ja text-base leading-none opacity-70" aria-hidden>
            {kanji}
          </span>
          {title}
        </h2>
        <span
          className="font-mono text-xs px-2 py-0.5 tabular-nums"
          style={{
            color: accent,
            background: mix(accent, 12),
            border: `1px solid ${mix(accent, 32)}`,
          }}
        >
          {count}
        </span>
      </header>
      <div
        className="h-px mb-5"
        style={{ background: `linear-gradient(90deg, ${mix(accent, 60)}, transparent)` }}
      />
      {entries.length === 0 ? (
        <Card className="p-8 text-center relative overflow-hidden">
          <span
            aria-hidden
            className="ja absolute -top-4 -right-3 text-[7rem] leading-none text-[var(--color-or)]/10 select-none"
          >
            {kanji}
          </span>
          <p className="relative text-[var(--color-ivoire-soft)] italic">
            {t("compare.bucket_empty", { default: "Rien de ce côté." })}
          </p>
        </Card>
      ) : (
        <ul className="space-y-4">
          {entries.map((e, i) => (
            <Reveal as="li" key={e.figure_id} delay={Math.min(i, 7) * 0.04} y={18}>
              <FigureCard
                figureId={e.figure_id}
                href={`/figures/${e.figure_id}`}
                name={e.figure_name}
                type={e.figure_type}
                manufacturer={e.manufacturer_name}
                imageUrl={e.figure_image}
              />
            </Reveal>
          ))}
        </ul>
      )}
    </Reveal>
  );
}

/**
 * Localized hero colour-wash — hanko-red on the left (your side), gold meeting
 * in the middle (shared pieces), a faint warm fade on the right (their side).
 * Self-contained inline styles. Static (no breathe — GPU-light); edges
 * feathered so the gradients fade instead of hard-cutting at the column.
 */
function HeroWash() {
  const wrap = {
    position: "absolute",
    top: "-3rem",
    left: "-3rem",
    right: "-3rem",
    height: "44vh",
    pointerEvents: "none",
    zIndex: 0,
    WebkitMaskImage:
      "linear-gradient(to right, transparent 0, #000 8%, #000 92%, transparent 100%)",
    maskImage:
      "linear-gradient(to right, transparent 0, #000 8%, #000 92%, transparent 100%)",
  };
  const base = { position: "absolute", inset: 0 };
  const layerYou = {
    background: `radial-gradient(50% 66% at 14% 6%, ${mix("var(--color-laque)", 16)}, transparent 70%)`,
  };
  const layerCommon = {
    background: `radial-gradient(42% 56% at 50% 0%, ${mix("var(--color-or)", 16)}, transparent 72%)`,
  };
  const layerThem = {
    background: `radial-gradient(50% 66% at 86% 6%, ${mix("var(--color-or-deep)", 12)}, transparent 70%)`,
  };
  return (
    <div aria-hidden style={wrap}>
      <span style={{ ...base, ...layerYou, opacity: 0.85 }} />
      <span style={{ ...base, ...layerCommon, opacity: 0.85 }} />
      <span style={{ ...base, ...layerThem, opacity: 0.85 }} />
    </div>
  );
}

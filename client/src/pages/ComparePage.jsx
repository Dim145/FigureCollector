import { Navigate, useParams } from "react-router-dom";
import { useT } from "../i18n/index.jsx";
import { useMe } from "../hooks/useMe.js";
import { useCompare } from "../hooks/useProfile.js";
import AppShell from "../components/AppShell.jsx";
import Card from "../components/Card.jsx";
import FigureCard from "../components/FigureCard.jsx";
import Reveal from "../components/motion/Reveal.jsx";

export default function ComparePage() {
  const { slug } = useParams();
  const t = useT();
  const me = useMe();
  const compare = useCompare(slug);

  if (me.isLoading) return null;
  if (!me.data?.authenticated) return <Navigate to="/login" replace />;
  if (compare.isLoading) return <AppShell><div role="status" aria-live="polite" className="text-center py-12 text-[var(--color-ivoire-soft)]">…</div></AppShell>;
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

  return (
    <AppShell>
      <main className="relative max-w-6xl mx-auto px-6 py-12 sm:py-16">
        {/* Localized hero colour-wash — split jade (you, left) → indigo (them,
            right) so the two-sided comparison reads at a glance. Gold meets in
            the middle for the shared pieces. Theme-aware, GPU breathe unless
            reduced-motion. */}
        <HeroWash />

        <header className="relative mb-12 text-center">
          <Reveal as="div" y={20}>
            <p className="micro">@{them.username}</p>
            <h1 className="display text-4xl sm:text-5xl md:text-6xl mt-2 text-[var(--color-ivoire)] leading-[0.98]">
              {t("compare.title", { name: them.display_name })}
            </h1>
            <div className="gold-rule mx-auto w-32 mt-6" />
          </Reveal>

          {/* Accent legend — anchors the jade/indigo language for the buckets. */}
          <Reveal as="div" delay={0.08} y={16} className="mt-6 flex justify-center gap-6 sm:gap-8">
            <LegendDot color="var(--color-jade)" label={t("compare.bucket.yours_only")} />
            <LegendDot color="var(--color-or)" label={t("compare.bucket.common")} />
            <LegendDot color="var(--color-indigo)" label={t("compare.bucket.theirs_only")} />
          </Reveal>
        </header>

        <div className="relative grid lg:grid-cols-3 gap-6">
          <Bucket title={t("compare.bucket.yours_only")} count={yours_only.length} entries={yours_only} accent="jade" delay={0} />
          <Bucket title={t("compare.bucket.common")} count={common.length} entries={common} accent="or" delay={0.06} />
          <Bucket title={t("compare.bucket.theirs_only")} count={theirs_only.length} entries={theirs_only} accent="indigo" delay={0.12} />
        </div>
      </main>
    </AppShell>
  );
}

const ACCENTS = {
  jade: "var(--color-jade)",
  indigo: "var(--color-indigo)",
  or: "var(--color-or)",
  laque: "var(--color-laque-bright)",
  ivoire: "var(--color-ivoire)",
};

function LegendDot({ color, label }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span
        aria-hidden
        className="h-2.5 w-2.5 rounded-full"
        style={{
          background: color,
          boxShadow: `0 0 12px color-mix(in oklab, ${color} 60%, transparent)`,
        }}
      />
      <span className="micro-tight">{label}</span>
    </span>
  );
}

function Bucket({ title, count, entries, accent, delay = 0 }) {
  const accentColor = ACCENTS[accent] ?? ACCENTS.or;
  return (
    <Reveal as="section" delay={delay} y={24} className="relative">
      <header className="flex items-baseline justify-between mb-4">
        <h2
          className="display text-2xl"
          style={{
            color: accentColor,
            textShadow: `0 0 26px color-mix(in oklab, ${accentColor} 32%, transparent)`,
          }}
        >
          {title}
        </h2>
        <span
          className="font-mono text-sm px-2 py-0.5 rounded-full"
          style={{
            color: accentColor,
            background: `color-mix(in oklab, ${accentColor} 12%, transparent)`,
            border: `1px solid color-mix(in oklab, ${accentColor} 32%, transparent)`,
          }}
        >
          {count}
        </span>
      </header>
      <div
        className="h-px mb-4"
        style={{
          background: `linear-gradient(90deg, color-mix(in oklab, ${accentColor} 60%, transparent), transparent)`,
        }}
      />
      {entries.length === 0 ? (
        <Card className="p-6 text-center text-[var(--color-ivoire-soft)]">—</Card>
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

/** color-mix helper — keep accent translucency in oklab, theme-var safe. */
function mix(accentVar, pct) {
  return `color-mix(in oklab, ${accentVar} ${pct}%, transparent)`;
}

/**
 * Localized hero colour-wash — jade on the left (your side), indigo on the
 * right (their side), gold meeting in the middle (shared pieces). Self-contained
 * inline styles. Static under prefers-reduced-motion; otherwise a slow GPU-only
 * opacity/scale breathe.
 */
function HeroWash() {
  // Static glow — no breathe (ambient motion removed for GPU). Edges feathered
  // so the gradients fade instead of hard-cutting at the content column.
  const wrap = {
    position: "absolute",
    top: "-3rem",
    left: "-3rem",
    right: "-3rem",
    height: "50vh",
    pointerEvents: "none",
    zIndex: 0,
    WebkitMaskImage:
      "linear-gradient(to right, transparent 0, #000 8%, #000 92%, transparent 100%)",
    maskImage:
      "linear-gradient(to right, transparent 0, #000 8%, #000 92%, transparent 100%)",
  };
  const base = { position: "absolute", inset: 0 };
  const layerYou = {
    background: `radial-gradient(50% 66% at 14% 6%, ${mix("var(--color-jade)", 20)}, transparent 70%)`,
  };
  const layerCommon = {
    background: `radial-gradient(40% 56% at 50% 0%, ${mix("var(--color-or)", 16)}, transparent 72%)`,
  };
  const layerThem = {
    background: `radial-gradient(50% 66% at 86% 6%, ${mix("var(--color-indigo)", 20)}, transparent 70%)`,
  };
  return (
    <div aria-hidden style={wrap}>
      <span style={{ ...base, ...layerYou, opacity: 0.85 }} />
      <span style={{ ...base, ...layerCommon, opacity: 0.85 }} />
      <span style={{ ...base, ...layerThem, opacity: 0.85 }} />
    </div>
  );
}

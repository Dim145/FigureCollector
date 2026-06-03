import { useMemo, useRef } from "react";
import { Link, Navigate } from "react-router-dom";
import { motion, useReducedMotion } from "motion/react";
import { useT } from "../i18n/index.jsx";
import { useMe } from "../hooks/useMe.js";
import {
  useAchievementsCatalog,
  useMyAchievements,
  useNextMilestones,
} from "../hooks/useAchievements.js";
import AppShell from "../components/AppShell.jsx";
import Reveal from "../components/motion/Reveal.jsx";
import EmptyState from "../components/EmptyState.jsx";

/**
 * /achievements — the Cabinet de Curiosités.
 *
 * This is the one page in the app that lets restraint go. Unlocked seals
 * feature the actual figurine that pushed the user over the threshold —
 * the user's own custom cover when set, otherwise the catalog photo —
 * framed in a metallic foil ring (gold / silver / bronze) that gleams via
 * a continuous conic-gradient sweep. Hover tilts the card in 3D, follows
 * the cursor with a category-coloured spotlight, and (for gold tiers)
 * dusts in five sparkles.
 *
 * Locked cards stay mysterious: the photo well shows a giant tier kanji
 * silhouette, the card is dimmed, and a "Verrouillé" pill names the
 * locked state without giving away what the threshold reveals.
 *
 * The hero pairs a SVG progress ring (animated stroke on mount) with a
 * large italic title, and a "Récemment apposés" rail surfaces the three
 * most recent unlocks as round-photo chips.
 */

// Each category gets its own accent kanji + colour theme — drives the
// inline custom property used by .ach-category-* styles and cards.
const CATEGORY_META = {
  collection: {
    kanji: "集",
    tone: "var(--ach-collection-tone)",
    toneSoft: "var(--ach-collection-soft)",
  },
  preorder: {
    kanji: "予",
    tone: "var(--ach-preorder-tone)",
    toneSoft: "var(--ach-preorder-soft)",
  },
  curator: {
    kanji: "画",
    tone: "var(--ach-curator-tone)",
    toneSoft: "var(--ach-curator-soft)",
  },
};

const TIER_KANJI = { gold: "金", silver: "銀", bronze: "銅" };

// Accent rhythm for unlocked seals. Rather than every seal glowing the same
// category gold, an unlocked card borrows the next hue in this cycle (keyed
// off its position in the grid) so a wall of earned seals reads as a chord,
// not a monotone. Each entry feeds the existing --ach-tone / --ach-tone-soft
// custom properties that .ach-card.is-unlocked already paints its border,
// shadow, spotlight and foil from. Pure CSS vars → flips with the theme.
const ACCENT_RHYTHM = [
  "var(--color-or)",
  "var(--color-jade)",
  "var(--color-indigo)",
  "var(--color-neon-cyan)",
  "var(--color-neon-magenta)",
];

function accentFor(index) {
  const tone = ACCENT_RHYTHM[index % ACCENT_RHYTHM.length];
  return {
    tone,
    soft: `color-mix(in oklab, ${tone} 22%, transparent)`,
  };
}

export default function AchievementsPage() {
  const t = useT();
  const me = useMe();
  const catalog = useAchievementsCatalog();
  const mine = useMyAchievements();
  const next = useNextMilestones();

  // Merge catalog + per-user data by code. Catalog is the source of truth
  // for what exists; mine just adds unlock metadata.
  const merged = useMemo(() => {
    if (!catalog.data) return [];
    const unlockedByCode = new Map(
      (mine.data ?? []).map((a) => [a.code, a]),
    );
    return [...catalog.data]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((a) => ({
        ...a,
        unlock: unlockedByCode.get(a.code) ?? null,
      }));
  }, [catalog.data, mine.data]);

  const grouped = useMemo(() => {
    const by = {};
    for (const a of merged) {
      by[a.category] ??= [];
      by[a.category].push(a);
    }
    return by;
  }, [merged]);

  const recent = useMemo(() => {
    return [...(mine.data ?? [])]
      .sort((a, b) => new Date(b.unlocked_at) - new Date(a.unlocked_at))
      .slice(0, 5);
  }, [mine.data]);

  if (me.isLoading) return null;
  if (!me.data?.authenticated) return <Navigate to="/login" replace />;

  if (catalog.isLoading || mine.isLoading) {
    return (
      <AppShell>
        <div
          role="status"
          aria-live="polite"
          className="text-center py-32 text-[var(--color-ivoire-soft)] italic"
        >
          …
        </div>
      </AppShell>
    );
  }
  if (catalog.isError || mine.isError) {
    return (
      <AppShell>
        <div
          role="alert"
          className="text-center py-32 text-[var(--color-ivoire-soft)] italic"
        >
          {t("error.unknown")}
        </div>
      </AppShell>
    );
  }

  const unlockedCount = mine.data?.length ?? 0;
  const totalCount = catalog.data?.length ?? 0;
  const pct =
    totalCount > 0 ? Math.round((unlockedCount / totalCount) * 100) : 0;

  // No achievements defined at all → a polished empty cabinet rather than a
  // bare page (Lot 6).
  if (totalCount === 0) {
    return (
      <AppShell>
        <main className="ach-page max-w-6xl mx-auto px-6 pt-8 pb-20">
          <EmptyState
            kanji="勲"
            title={t("achievements.empty.title")}
            body={t("achievements.empty.body")}
          />
        </main>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <main className="ach-page max-w-6xl mx-auto px-6 pt-8 pb-20">
        <Hero
          unlocked={unlockedCount}
          total={totalCount}
          percent={pct}
          t={t}
        />

        {recent.length > 0 ? <RecentStrip recent={recent} t={t} /> : null}

        {(next.data?.length ?? 0) > 0 ? <NextPalier milestones={next.data} t={t} /> : null}

        {Object.entries(grouped).map(([category, items]) => (
          <CategorySection
            key={category}
            category={category}
            items={items}
            t={t}
          />
        ))}
      </main>
    </AppShell>
  );
}

// =============================================================================
// Prochain palier (Lot 5) — distance to the nearest locked achievements.
// Reuses the ach-recent heading + the pal-* classes from the validated maquette.
// =============================================================================
function NextPalier({ milestones, t }) {
  return (
    <Reveal as="section" y={16} className="mt-2">
      <p className="ach-recent-heading">{t("palier.title")}</p>
      <div className="ins-panel" style={{ marginTop: "0.75rem" }}>
        {milestones.map((m) => (
          <div className="pal-row" key={m.code}>
            <span className="pal-k ja" aria-hidden>
              {TIER_KANJI[m.tier] ?? "印"}
            </span>
            <div>
              <div className="pal-name">
                {t(`achievements.label.${m.code}`, { default: m.code })}
              </div>
              <div className="pal-hint">
                {t("palier.remaining")}{" "}
                <span className="need">
                  {t(`palier.need.${m.kind}`, { n: m.remaining, default: `${m.remaining}` })}
                </span>
              </div>
            </div>
            <span className={`pal-tier ${m.tier}`}>
              {t(`palier.tier.${m.tier}`, { default: m.tier })} · {m.threshold}
            </span>
            <span className="pal-track">
              <span
                className="pal-fill"
                style={{ width: `${Math.min(100, Math.max(0, m.pct))}%` }}
              />
            </span>
          </div>
        ))}
      </div>
    </Reveal>
  );
}

// =============================================================================
// Hero — animated progress ring + title
// =============================================================================

function Hero({ unlocked, total, percent, t }) {
  // SVG ring math — circumference of a circle is 2πr. The stroke-dasharray
  // makes the visible arc proportional to the percentage.
  const r = 64;
  const c = 2 * Math.PI * r;
  const dash = (percent / 100) * c;

  return (
    <header className="ach-hero">
      {/* Localized hero colour-wash: a soft multi-accent bloom that sits
       *  behind the progress ring + title. Absolute + pointer-events-none so
       *  it never intercepts clicks; low-alpha accent vars so it tints rather
       *  than floods, and flips correctly between light/dark themes. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-x-8 -top-10 bottom-0 z-0"
        style={{
          background:
            "radial-gradient(60% 80% at 18% 30%, color-mix(in oklab, var(--color-or) 16%, transparent), transparent 70%), radial-gradient(55% 75% at 82% 60%, color-mix(in oklab, var(--color-indigo) 14%, transparent), transparent 72%), radial-gradient(50% 60% at 60% 0%, color-mix(in oklab, var(--color-jade) 10%, transparent), transparent 70%)",
        }}
      />
      <div className="ach-hero-ring" aria-hidden>
        <svg className="ach-hero-ring-svg" viewBox="0 0 144 144">
          <circle className="ach-hero-ring-track" cx="72" cy="72" r={r} />
          <circle
            className="ach-hero-ring-fill"
            cx="72"
            cy="72"
            r={r}
            style={{ strokeDasharray: `${dash} ${c}` }}
          />
        </svg>
        <div className="ach-hero-ring-text">
          <div>
            <span className="ach-hero-ring-num">{unlocked}</span>
            <span className="ach-hero-ring-total">/ {total}</span>
          </div>
        </div>
      </div>

      <div className="ach-hero-text">
        <p className="ach-hero-eyebrow">{t("achievements.subtitle")}</p>
        <h1 className="ach-hero-title">{t("achievements.title")}</h1>
        <p className="ach-hero-percent">
          {percent === 100
            ? t("achievements.progress.complete")
            : t("achievements.progress.percent", { n: percent })}
        </p>
      </div>
    </header>
  );
}

function RecentStrip({ recent, t }) {
  return (
    <Reveal as="section" className="ach-recent" y={20}>
      <p className="ach-recent-heading">{t("achievements.recent")}</p>
      <div className="ach-recent-rail">
        {recent.map((a, i) => (
          <RecentChip key={a.code} unlock={a} index={i} t={t} />
        ))}
      </div>
    </Reveal>
  );
}

function RecentChip({ unlock, index, t }) {
  // Recent unlocks share the same accent rhythm as the grid so the rail and
  // the wall feel like the same chord. The chip's --ach-tone is consumed by
  // the inline halo below; CSS-var only, so it flips with the theme. (The rail
  // as a whole is revealed by the section-level Reveal — keeping the chip a
  // bare <Link> preserves both routing and the flex-rail sizing.)
  const accent = accentFor(index);
  return (
    <Link
      to={unlock.trigger_figure_slug ? `/figures/${unlock.trigger_figure_id}` : "#"}
      className="ach-recent-chip"
      style={{
        "--ach-tone": accent.tone,
        boxShadow: `0 14px 30px -22px ${accent.tone}`,
      }}
    >
      <span className="ach-recent-chip-img">
        {unlock.trigger_image_url ? (
          <img
            src={unlock.trigger_image_url}
            alt={unlock.trigger_figure_name ?? unlock.code}
            loading="lazy"
          />
        ) : (
          <span className="ach-recent-chip-img-fallback" aria-hidden>
            {TIER_KANJI[unlock.tier] ?? "印"}
          </span>
        )}
      </span>
      <span className="ach-recent-chip-body">
        <span className="ach-recent-chip-label">
          {t(`achievements.label.${unlock.code}`, { default: unlock.code })}
        </span>
        <span className="ach-recent-chip-date">
          {new Date(unlock.unlocked_at).toLocaleDateString()}
        </span>
      </span>
    </Link>
  );
}

function CategorySection({ category, items, t }) {
  const meta = CATEGORY_META[category] ?? CATEGORY_META.collection;
  const unlockedCount = items.filter((i) => i.unlock).length;
  return (
    <section
      className="ach-category"
      style={{
        "--ach-tone": meta.tone,
        "--ach-tone-soft": meta.toneSoft,
      }}
    >
      <header className="ach-category-header">
        <span className="ach-category-kanji" aria-hidden>
          {meta.kanji}
        </span>
        <div className="ach-category-text">
          <h2 className="ach-category-title">
            {t(`achievements.category.${category}`)}
          </h2>
          <p className="ach-category-desc">
            {t(`achievements.category.${category}.desc`, {
              default: "",
            })}
          </p>
        </div>
        <span className="ach-category-count">
          {unlockedCount} / {items.length}
        </span>
      </header>

      <ul className="ach-grid">
        {items.map((a, i) => (
          <AchCard key={a.code} achievement={a} index={i} t={t} />
        ))}
      </ul>
    </section>
  );
}

function AchCard({ achievement: a, index, t }) {
  const ref = useRef(null);
  const reduce = useReducedMotion();
  const unlocked = !!a.unlock;
  const u = a.unlock;

  // Unlocked seals borrow a hue from the accent rhythm so the wall reads as a
  // chord; locked seals stay on a single muted gold so they recede.
  const accent = accentFor(index);

  // Mouse tracking for the spotlight — only meaningful on unlocked cards.
  const onMove = (e) => {
    if (!unlocked) return;
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty(
      "--spotlight-x",
      `${((e.clientX - r.left) / r.width) * 100}%`,
    );
    el.style.setProperty(
      "--spotlight-y",
      `${((e.clientY - r.top) / r.height) * 100}%`,
    );
  };

  const inner = (
    <>
      <div className="ach-card-photo">
        <span className="ach-card-foil" aria-hidden />
        {unlocked && u.trigger_image_url ? (
          <img
            src={u.trigger_image_url}
            alt={u.trigger_figure_name ?? a.code}
            loading="lazy"
          />
        ) : (
          <span className="ach-card-photo-kanji" aria-hidden>
            {TIER_KANJI[a.tier]}
          </span>
        )}
        <span className="ach-card-tier-badge" aria-hidden>
          {TIER_KANJI[a.tier]}
        </span>
      </div>

      <div className="ach-card-body">
        <span className="ach-card-label">
          {t(`achievements.label.${a.code}`, {
            default: a.code,
            threshold: a.threshold,
          })}
        </span>
        <span className="ach-card-threshold">
          {t(`achievements.threshold.${a.kind}`, {
            n: a.threshold,
            default: `× ${a.threshold}`,
          })}
        </span>

        {unlocked ? (
          <>
            <span className="ach-card-meta">
              {t("achievements.unlocked_on", {
                date: new Date(u.unlocked_at).toLocaleDateString(),
              })}
            </span>
            {u.trigger_figure_name ? (
              <span
                className="ach-card-trigger"
                title={u.trigger_figure_name}
              >
                ↳ {u.trigger_figure_name}
              </span>
            ) : null}
          </>
        ) : (
          <span className="ach-card-locked-pill">
            <span aria-hidden>🔒</span>
            {t("achievements.locked")}
          </span>
        )}
      </div>
    </>
  );

  const className = `ach-card tier-${a.tier} ${
    unlocked ? "is-unlocked" : "is-locked"
  }`;
  // Unlocked → paint the rhythm accent into the vars the stylesheet already
  // consumes (border / shadow / spotlight). Locked → pin a single dim gold so
  // they stay muted and uniform. Always pure CSS vars: theme-correct.
  const style = unlocked
    ? { "--i": index, "--ach-tone": accent.tone, "--ach-tone-soft": accent.soft }
    : {
        "--i": index,
        "--ach-tone": "color-mix(in oklab, var(--color-or) 45%, transparent)",
        "--ach-tone-soft": "transparent",
      };

  // Entrance is owned by the <Reveal> wrapper (the scroll-cascade the brief
  // asks for). On top of that, an *earned* seal gets a springy "pop" when the
  // pointer lands on it — a small reward gesture layered over the card's
  // existing 3D tilt. Scale/opacity only → GPU-cheap; the whole wrapper is
  // inert (no whileHover) under prefers-reduced-motion.
  const popProps =
    unlocked && !reduce
      ? {
          whileHover: { scale: 1.03 },
          whileTap: { scale: 0.99 },
          transition: { type: "spring", stiffness: 360, damping: 20 },
        }
      : null;

  // Unlocked cards with a known figure link to the figure page; otherwise
  // the card is just a presentational tile. A motion wrapper carries the pop
  // so the inner anchor/div keeps its existing 3D tilt + spotlight intact.
  const cardEl =
    unlocked && u.trigger_figure_id ? (
      <Link
        ref={ref}
        to={`/figures/${u.trigger_figure_id}`}
        onMouseMove={onMove}
        className={className}
        style={style}
      >
        {inner}
      </Link>
    ) : (
      <div
        ref={ref}
        onMouseMove={onMove}
        className={className}
        style={style}
      >
        {inner}
      </div>
    );

  return (
    <Reveal as="li" y={24} delay={(index % 8) * 0.05}>
      {popProps ? (
        <motion.div style={{ height: "100%" }} {...popProps}>
          {cardEl}
        </motion.div>
      ) : (
        cardEl
      )}
    </Reveal>
  );
}

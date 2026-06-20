import { useMemo } from "react";
import { Navigate, useParams } from "react-router-dom";
import { useT } from "../i18n/index.jsx";
import { useMe } from "../hooks/useMe.js";
import { useCompare } from "../hooks/useProfile.js";
import { StatCard, EmptyState, Spinner } from "../components/ui/index.js";
import { PageLayout, Section } from "../components/layout/index.js";
import AppShell from "../components/AppShell.jsx";
import Reveal from "../components/motion/Reveal.jsx";
import CompareShelf from "./profile/CompareShelf.jsx";
import CompareBucket from "./profile/CompareBucket.jsx";
import CompareWash from "./profile/CompareWash.jsx";

/**
 * /u/:slug/compare — "moi vs @slug" (Direction A "Le croisement"), rebuilt on
 * the shared foundation.
 *
 * Thin orchestrator: derives the comparative metrics from the three buckets the
 * API returns, then composes `PageLayout` (breadcrumb COMMUNAUTÉ › @slug ›
 * Comparaison) → a headline `StatCard` strip → a designed two-column "vs"
 * spread (`CompareShelf`) → three `CompareBucket` columns listing the actual
 * specimens (yours-only / common / theirs-only).
 *
 * `CompareEntry` carries `figure_type` + `manufacturer_name` only (no value /
 * series in the payload), so we surface piece / maker / type overlap — the
 * figurine metrics the playbook allows, no manga "completion". Palette stays
 * on-direction: hanko-red is *your* side (the only hot accent), gold marks the
 * shared pieces (value / overlap), ivoire keeps their side quiet. GPU-light:
 * one static feathered wash, hairlines, the shared `Reveal` enter motion.
 */
export default function ComparePage() {
  const { slug } = useParams();
  const t = useT();
  const me = useMe();
  const compare = useCompare(slug);

  // Comparative metrics — derived from the three buckets the API returns.
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
        <div className="flex items-center justify-center py-24 text-[var(--color-ivoire-soft)]">
          <Spinner size={28} label={t("common.loading", { default: "Chargement…" })} />
        </div>
      </AppShell>
    );
  }

  if (compare.error || !compare.data) {
    return (
      <AppShell>
        <PageLayout
          width="prose"
          breadcrumbs={[
            { label: t("nav.community", { default: "Communauté" }), to: "/community" },
            { label: `@${slug}`, to: `/u/${slug}` },
            { label: t("compare.crumb", { default: "Comparaison" }) },
          ]}
        >
          <EmptyState kanji="対" title="404" body={t("error.unknown")} />
        </PageLayout>
      </AppShell>
    );
  }

  const { them, common, yours_only, theirs_only } = compare.data;
  const youName =
    me.data.user?.display_name || me.data.user?.username || t("follow.you", { default: "Vous" });

  return (
    <AppShell>
      <PageLayout
        kanji="対"
        title={t("compare.title", { name: them.display_name })}
        breadcrumbs={[
          { label: t("nav.community", { default: "Communauté" }), to: "/community" },
          { label: `@${them.username}`, to: `/u/${them.username}` },
          { label: t("compare.crumb", { default: "Comparaison" }) },
        ]}
      >
        {/* Quiet localized wash behind the top of the page (GPU-light). */}
        <div className="relative">
          <CompareWash />

          <Reveal
            as="p"
            className="relative display-italic text-[var(--color-or)] text-lg max-w-xl mb-10"
          >
            {t("compare.lede", {
              default:
                "Deux vitrines mises en regard — ce que vous partagez, ce qui vous distingue.",
            })}
          </Reveal>

          {/* ─── Comparative stat strip — the headline numbers ─── */}
          {metrics ? (
            <Reveal as="div" className="relative grid grid-cols-2 lg:grid-cols-4 gap-3 mb-12">
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
                  default: `${metrics.yoursOnly} en propre`,
                })}
                tone="red"
              />
              <StatCard
                label={t("compare.stat.theirs", { name: them.display_name, default: "Ses pièces" })}
                value={metrics.theirsTotal}
                sub={t("compare.stat.only_sub", {
                  n: metrics.theirsOnly,
                  default: `${metrics.theirsOnly} en propre`,
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
        </div>

        {/* ─── The two-column "vs" spread — shared count on the spine ─── */}
        {metrics ? (
          <Section
            kicker={
              <span className="inline-flex items-center gap-2">
                <span
                  aria-hidden
                  className="ja not-italic text-base text-[var(--color-or)] leading-none"
                >
                  対
                </span>
                {t("compare.spread_kicker", { default: "TÊTE À TÊTE" })}
              </span>
            }
            divider
          >
            <Reveal as="div">
              <CompareShelf
                metrics={metrics}
                youName={youName}
                themName={them.display_name}
                t={t}
              />
            </Reveal>
          </Section>
        ) : null}

        {/* ─── Buckets — the actual specimens ─── */}
        <Section
          kicker={
            <span className="inline-flex items-center gap-2">
              <span
                aria-hidden
                className="ja not-italic text-base text-[var(--color-or)] leading-none"
              >
                棚
              </span>
              {t("compare.lists_kicker", { default: "LES PIÈCES" })}
            </span>
          }
          divider
        >
          <div className="grid lg:grid-cols-3 gap-6 lg:gap-5">
            <CompareBucket
              title={t("compare.bucket.yours_only")}
              kanji="己"
              count={yours_only.length}
              entries={yours_only}
              accent="var(--color-laque-bright)"
              t={t}
              delay={0}
            />
            <CompareBucket
              title={t("compare.bucket.common")}
              kanji="共"
              count={common.length}
              entries={common}
              accent="var(--color-or)"
              t={t}
              delay={0.06}
            />
            <CompareBucket
              title={t("compare.bucket.theirs_only")}
              kanji="彼"
              count={theirs_only.length}
              entries={theirs_only}
              accent="var(--color-ivoire)"
              t={t}
              delay={0.12}
            />
          </div>
        </Section>
      </PageLayout>
    </AppShell>
  );
}

import { useMemo } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { useT } from "../i18n/index.jsx";
import { useMe } from "../hooks/useMe.js";
import { useCompare } from "../hooks/useProfile.js";
import { Button, StatCard, EmptyState, Spinner } from "../components/ui/index.js";
import { PageLayout, Section } from "../components/layout/index.js";
import Money from "../components/Money.jsx";
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

  // Comparative metrics — bucket counts are derived here; the affinity score
  // and shared-facet tallies now come from the server (a transparent
  // Sørensen–Dice over shared series / makers / pieces).
  const metrics = useMemo(() => {
    const d = compare.data;
    if (!d) return null;
    const { common, yours_only, theirs_only } = d;
    return {
      yoursTotal: common.length + yours_only.length,
      theirsTotal: common.length + theirs_only.length,
      common: common.length,
      yoursOnly: yours_only.length,
      theirsOnly: theirs_only.length,
      affinity: d.affinity ?? 0,
      sharedSeries: d.shared_series?.length ?? 0,
      sharedMakers: d.shared_manufacturers?.length ?? 0,
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
    // Distinguish the failure modes instead of collapsing them all into a
    // generic "404": 401 (sign in), 404 (private / unknown), 400 (self), else
    // a genuine server error.
    const status = compare.error?.status;
    const view =
      status === 401
        ? {
            kanji: "鍵",
            title: t("compare.err.auth_title", { default: "Connexion requise" }),
            body: t("compare.err.auth_body", {
              default: "Connecte-toi pour comparer vos vitrines.",
            }),
          }
        : status === 404
          ? {
              kanji: "鍵",
              title: "404",
              body: t("compare.err.private_body", {
                default: "Ce profil est privé ou introuvable.",
              }),
            }
          : status === 400
            ? {
                kanji: "対",
                title: t("compare.err.self_title", { default: "Vous-même" }),
                body: t("compare.err.self_body", {
                  default: "On ne peut pas se comparer à soi-même.",
                }),
              }
            : {
                kanji: "対",
                title: t("compare.err.fail_title", { default: "Comparaison indisponible" }),
                body: t("error.unknown"),
                retry: true,
              };
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
          <EmptyState
            kanji={view.kanji}
            eyebrow={t("compare.crumb", { default: "Comparaison" })}
            title={view.title}
            body={view.body}
          >
            <div className="flex flex-wrap items-center justify-center gap-3">
              {view.retry ? (
                <Button onClick={() => compare.refetch()}>
                  {t("compare.err.retry", { default: "Réessayer" })}
                </Button>
              ) : null}
              <Link to={`/u/${slug}`}>
                <Button variant="ghost">
                  {t("compare.err.back", { default: "Retour au profil" })}
                </Button>
              </Link>
            </div>
          </EmptyState>
        </PageLayout>
      </AppShell>
    );
  }

  const { them, common, yours_only, theirs_only } = compare.data;
  const youName =
    me.data.user?.display_name || me.data.user?.username || t("follow.you", { default: "Vous" });
  // Only `yours_only` can carry NSFW (the target's is excluded server-side).
  // Unlike the collection grid (which never receives NSFW when the pref is
  // "hide"), compare keeps the viewer's OWN NSFW pieces — so blur for any
  // non-"show" pref (the safe floor for a "hide" viewer).
  const nsfwBlur = (me.data?.user?.nsfw_visibility ?? "hide") !== "show";

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
                label={t("compare.stat.shared_series", { default: "Séries communes" })}
                value={metrics.sharedSeries}
                sub={t("compare.stat.shared_makers_sub", {
                  n: metrics.sharedMakers,
                  default: `${metrics.sharedMakers} fabricants partagés`,
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
              <p className="mt-3 text-center text-[12px] italic text-[var(--color-ivoire-soft)]/70">
                {t("compare.affinity_help")}
              </p>
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
              nsfwBlur={nsfwBlur}
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

        {/* ─── Terrain commun — shared series & manufacturers ─── */}
        {compare.data.shared_series?.length > 0 ||
        compare.data.shared_manufacturers?.length > 0 ? (
          <Section
            kicker={
              <span className="inline-flex items-center gap-2">
                <span
                  aria-hidden
                  className="ja not-italic text-base text-[var(--color-or)] leading-none"
                >
                  縁
                </span>
                {t("compare.terrain_kicker", { default: "TERRAIN COMMUN" })}
              </span>
            }
            divider
          >
            <Reveal as="div" className="grid sm:grid-cols-2 gap-8 lg:gap-12">
              <TerrainList
                title={t("compare.terrain.series", { default: "Séries" })}
                facets={compare.data.shared_series}
                t={t}
              />
              <TerrainList
                title={t("compare.terrain.makers", { default: "Fabricants" })}
                facets={compare.data.shared_manufacturers}
                t={t}
              />
            </Reveal>
          </Section>
        ) : null}

        {/* ─── Valeur — paired collection totals (theirs only if published) ─── */}
        {compare.data.value &&
        (compare.data.value.yours?.length > 0 || compare.data.value.theirs?.length > 0) ? (
          <Section
            kicker={
              <span className="inline-flex items-center gap-2">
                <span
                  aria-hidden
                  className="ja not-italic text-base text-[var(--color-or)] leading-none"
                >
                  価
                </span>
                {t("compare.value_kicker", { default: "VALEUR" })}
              </span>
            }
            divider
          >
            <Reveal as="div" className="grid grid-cols-2 gap-3">
              <ValueKpi
                label={t("compare.value.yours", { default: "Votre collection" })}
                totals={compare.data.value.yours}
                accent="var(--color-laque)"
                t={t}
              />
              <ValueKpi
                label={t("compare.value.theirs", {
                  name: them.display_name,
                  default: "Sa collection",
                })}
                totals={compare.data.value.theirs}
                accent="var(--color-or)"
                emptyLabel={t("compare.value.private", { default: "Valeur non publiée" })}
                t={t}
              />
            </Reveal>
          </Section>
        ) : null}
      </PageLayout>
    </AppShell>
  );
}

/**
 * Shared-terrain column — the series or manufacturers BOTH collect, as ranked
 * gold hairline bars (combined piece count). Quiet empty state when there's no
 * overlap on this dimension.
 */
function TerrainList({ title, facets, t }) {
  const rows = facets ?? [];
  const max = rows.length ? Math.max(...rows.map((f) => f.count)) : 1;
  return (
    <div>
      <p className="micro-tight mb-3 text-[var(--color-or-pale)]/80">{title}</p>
      {rows.length === 0 ? (
        <p className="text-sm italic text-[var(--color-ivoire-soft)]/70">
          {t("compare.terrain_empty", { default: "Rien en commun ici." })}
        </p>
      ) : (
        <ul className="space-y-3">
          {rows.map((f) => (
            <li key={f.name} className="grid grid-cols-[1fr_auto] items-center gap-3">
              <div className="min-w-0">
                <p className="text-sm text-[var(--color-ivoire)] truncate">{f.name}</p>
                <span
                  aria-hidden
                  className="mt-1 block h-1 rounded-full bg-[var(--color-or)]"
                  style={{ width: `${Math.max(8, (f.count / max) * 100)}%`, opacity: 0.55 }}
                />
              </div>
              <span className="font-mono text-xs tabular-nums text-[var(--color-or-pale)]/80">
                {f.count}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Paired value KPI — one collector's total (dominant currency leads, "…" hints
 * at more). `theirs` arrives empty unless they published their value, so it
 * shows a quiet "non publiée" instead of a number.
 */
function ValueKpi({ label, totals, accent, emptyLabel }) {
  const has = totals && totals.length > 0;
  return (
    <div
      className="border border-[var(--color-or)]/15 bg-[var(--color-noir-soft)] px-4 py-3.5"
      style={{ borderLeft: `2px solid ${accent}` }}
    >
      <p className="label-mono text-[var(--color-ivoire-soft)]/70">{label}</p>
      {has ? (
        <p className="figural text-2xl mt-1.5 leading-none text-[var(--color-ivoire)]">
          <Money amount={totals[0].amount} currency={totals[0].currency} round />
          {totals.length > 1 ? " …" : ""}
        </p>
      ) : (
        <p className="text-sm italic text-[var(--color-ivoire-soft)]/60 mt-2">{emptyLabel}</p>
      )}
    </div>
  );
}

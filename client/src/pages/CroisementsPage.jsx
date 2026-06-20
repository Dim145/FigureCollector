import { useMemo } from "react";
import { Navigate } from "react-router-dom";
import { useT } from "../i18n/index.jsx";
import { useMe } from "../hooks/useMe.js";
import { useMangaLink, useCrossings } from "../hooks/useMangaLink.js";
import AppShell from "../components/AppShell.jsx";
import Card from "../components/Card.jsx";
import StatCard from "../components/StatCard.jsx";
import { SectionSkeleton } from "../components/Skeleton.jsx";
import { PageLayout } from "../components/layout/index.js";
import { communityKicker } from "./community/CommunityKicker.js";
import CrossingColumn from "./community/CrossingColumn.jsx";
import ReadingCard from "./community/ReadingCard.jsx";
import DualRow from "./community/DualRow.jsx";
import { NotLinked, NotActive } from "./community/CrossingsEmptyCard.jsx";

/**
 * Croisements (/community/croisements) — the MangaCollector cross-link
 * discovery page, rebuilt on the shared foundation (Direction A "Shōjo-Noir").
 *
 * Two relational lists keyed on the series' shared MAL id:
 *   · LEFT  — figures from series you read but don't own yet (a wishlist nudge;
 *             hanko-red carries the discovery energy).            (reading[])
 *   · RIGHT — series present on both shelves — manga + figurine, the heart of a
 *             collection (gold marks the value/overlap).               (dual[])
 *
 * A thin orchestrator: it owns the link + crossings queries and the derived
 * metric strip, then composes the page-local sub-components under ./community/
 * inside the standard <PageLayout> (Communauté 縁 kicker + watermark). Needs an
 * APPROVED manga link to mean anything; unlinked / pending / revoked users get
 * an editorial EmptyState that points at Settings.
 */
export default function CroisementsPage() {
  const t = useT();
  const me = useMe();
  const link = useMangaLink();
  const connected = !!link.data?.connected;
  const status = link.data?.status ?? null;
  // Crossings only resolve for an APPROVED server; pending/revoked links get a
  // status state instead of a (necessarily empty) result.
  const active = status === "approved";
  const crossings = useCrossings(active);

  const reading = useMemo(() => crossings.data?.reading ?? [], [crossings.data]);
  const dual = useMemo(() => crossings.data?.dual ?? [], [crossings.data]);

  // Figurine-metric strip — derived from the two crossing lists + the linked
  // library profile. Counts only, computed before the early returns so the hook
  // order stays stable across auth state.
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
      <PageLayout
        kicker={communityKicker(t, t("nav.croisements", { default: "Croisements" }).toUpperCase())}
        title={t("manga.croisements.title")}
        kanji="縁"
        width="standard"
      >
        <p className="display italic text-[var(--accent)] text-lg -mt-2 mb-8 max-w-2xl">
          {t("manga.croisements.subtitle")}
        </p>

        {/* Figurine-metric strip (only when there's something to count). */}
        {showStrip ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-10">
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
          </div>
        ) : null}

        {!connected ? (
          <NotLinked t={t} />
        ) : !active ? (
          <NotActive t={t} status={status} reason={link.data?.revoked_reason} />
        ) : crossings.isLoading ? (
          <SectionSkeleton blocks={3} />
        ) : (
          <div className="grid lg:grid-cols-2 gap-8 lg:gap-10">
            {/* LEFT: figures from series you read — the discovery nudge */}
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

            {/* RIGHT: series present on both shelves — the value ledger */}
            <CrossingColumn
              kanji="双"
              accent="var(--accent)"
              eyebrow={t("manga.croisements.dual.sub")}
              title={t("manga.croisements.dual.title")}
              count={dual.length}
              caption={t("manga.croisements.dual.cap")}
              empty={t("manga.croisements.dual.empty")}
              isEmpty={dual.length === 0}
              delay={0.06}
            >
              <Card as="ul" className="divide-y divide-[var(--border-subtle)]">
                {dual.map((d, i) => (
                  <DualRow key={d.mal_id} d={d} t={t} i={i} />
                ))}
              </Card>
            </CrossingColumn>
          </div>
        )}
      </PageLayout>
    </AppShell>
  );
}

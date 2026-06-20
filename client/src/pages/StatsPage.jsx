import { Link, Navigate } from "react-router-dom";
import { FileDown } from "lucide-react";
import { useT } from "../i18n/index.jsx";
import { useMe } from "../hooks/useMe.js";
import { useMyStats, useInsights } from "../hooks/useStats.js";
import AppShell from "../components/AppShell.jsx";
import PageSkeleton from "../components/Skeleton.jsx";
import ErrorState from "../components/ErrorState.jsx";
import EmptyState from "../components/EmptyState.jsx";
import { Button } from "../components/ui/index.js";
import { PageLayout } from "../components/layout/index.js";

import StatsTitlePage from "./insights/StatsTitlePage.jsx";
import ChapterNav from "./insights/ChapterNav.jsx";
import LazyChapter from "./insights/LazyChapter.jsx";
import SpendChapter from "./insights/SpendChapter.jsx";
import AllocationChapter from "./insights/AllocationChapter.jsx";
import PalmaresChapter from "./insights/PalmaresChapter.jsx";
import ChronicleChapter from "./insights/ChronicleChapter.jsx";
import CrownPriceChapter from "./insights/CrownPriceChapter.jsx";
import InsightsChapters from "./insights/InsightsChapters.jsx";

/**
 * Insights — "Le Grand Livre", the collection read as numbers + an editorial
 * almanac (spend · allocation · palmarès · chronicle · crown pieces · price
 * scale · deep insights).
 *
 * This file is a THIN orchestrator: it owns the data hooks + gating + the
 * chapter composition, and delegates every chapter and chart to a focused
 * page-local component under `insights/`. Chapters below the fold mount on
 * scroll (LazyChapter) so first paint is just the frontispiece + the first
 * chapter; a sticky ChapterNav (table of contents) tracks the visible chapter.
 * Heavy bespoke styling lives in the shared `.chapter-rule` / `.ledger-*` /
 * `.ins-*` / `.press-*` / `.podium-*` / `.price-scale*` classes already in
 * index.css.
 */
export default function StatsPage() {
  const t = useT();
  const me = useMe();
  const stats = useMyStats();
  const insights = useInsights();

  if (me.isLoading) return null;
  if (!me.data?.authenticated) return <Navigate to="/login" replace />;

  if (stats.isLoading) {
    return (
      <AppShell>
        <PageLayout width="wide">
          <PageSkeleton blocks={4} />
        </PageLayout>
      </AppShell>
    );
  }

  if (stats.isError) {
    return (
      <AppShell>
        <PageLayout width="wide">
          <ErrorState error={stats.error} onRetry={() => stats.refetch()} />
        </PageLayout>
      </AppShell>
    );
  }

  const data = stats.data;
  const year = new Date().getFullYear();
  const empty = !data || data.total_pieces === 0;

  // Primary CTA — "Exporter le bilan". The bilan/inventaire + insurance-dossier
  // exports live in Settings › Archives today; deep-link straight to them.
  // Rendered inside the page (not PageLayout's toolbar slot) so it can sit with
  // the frontispiece even though the page has no PageLayout title.
  const exportCta = (
    <div className="flex justify-end mb-2">
      <Button
        as={Link}
        to="/settings#archives"
        size="sm"
        variant="ghost"
        iconStart={<FileDown size={16} aria-hidden />}
      >
        {t("stats.export.cta", { default: "Exporter le bilan" })}
      </Button>
    </div>
  );

  if (empty) {
    return (
      <AppShell>
        <PageLayout width="wide">
          {exportCta}
          <StatsTitlePage data={null} t={t} year={year} />
          <div className="mt-10">
            <EmptyState
              kanji="財"
              eyebrow={t("stats.subtitle")}
              title={t("stats.empty.title", { default: "Le grand livre est vierge" })}
              body={t("stats.empty")}
            >
              <Button as={Link} to="/figures/new">
                {t("stats.empty.cta", { default: "Ajouter une pièce" })}
              </Button>
            </EmptyState>
          </div>
        </PageLayout>
      </AppShell>
    );
  }

  // Which chapters actually render (chapters self-hide on empty slices) — drives
  // the jump-nav so the table of contents matches what's on the page.
  const insightsData = insights.data;
  const chapters = buildChapterList(data, insightsData, t);

  return (
    <AppShell>
      <PageLayout width="wide">
        {exportCta}
        <div className="grid lg:grid-cols-[200px_minmax(0,1fr)] gap-8 lg:gap-12">
          {/* Sticky jump-nav rail (TOC). Hidden when there are <2 chapters. */}
          <div className="lg:order-1">
            <ChapterNav chapters={chapters} />
          </div>

          <div className="min-w-0 lg:order-2">
            {/* I — Frontispiece (eager) */}
            <StatsTitlePage data={data} t={t} year={year} />

            {/* II — Dépenses (eager: first chapter, above the fold) */}
            <SpendChapter data={data} t={t} />

            {/* III+ — mount on scroll */}
            <LazyChapter>
              <AllocationChapter data={data} t={t} />
            </LazyChapter>

            <LazyChapter>
              <PalmaresChapter data={data} t={t} />
            </LazyChapter>

            <LazyChapter>
              <ChronicleChapter data={data} t={t} />
            </LazyChapter>

            <LazyChapter minHeight={480}>
              <CrownPriceChapter data={data} t={t} />
            </LazyChapter>

            {insightsData ? (
              <LazyChapter minHeight={240}>
                <InsightsChapters insights={insightsData} t={t} />
              </LazyChapter>
            ) : null}

            <Colophon t={t} pieces={data.total_pieces} year={year} />
          </div>
        </div>
      </PageLayout>
    </AppShell>
  );
}

/**
 * Mirror each chapter's self-hide logic to produce the jump-nav entries. Keep
 * this in lockstep with the `id=` anchors set on every ChapterRule.
 */
function buildChapterList(data, insights, t) {
  const out = [
    { id: "ch-spend", roman: "II", label: t("stats.ch.spend") },
    { id: "ch-allocation", roman: "III", label: t("stats.ch.allocation") },
    { id: "ch-palmares", roman: "IV", label: t("stats.ch.tops") },
    { id: "ch-chronicle", roman: "V", label: t("stats.ch.timeline") },
    { id: "ch-crown", roman: "VI", label: t("stats.ch.crown") },
  ];
  if ((data.price_distribution ?? []).length > 0) {
    out.push({ id: "ch-scale", roman: "VII", label: t("stats.ch.scale") });
  }
  if (insights) {
    const ph = insights.preorder_health ?? {};
    if ((insights.spend_by_year ?? []).length > 0) {
      out.push({ id: "ch-spend-year", roman: "VIII", label: t("insights.ch.spend") });
    }
    if ((insights.series_completion ?? []).length > 0) {
      out.push({ id: "ch-completion", roman: "IX", label: t("insights.ch.completion") });
    }
    if ((insights.wishlist_value ?? []).length > 0 || (insights.wishlist_count ?? 0) > 0) {
      out.push({ id: "ch-wishlist", roman: "X", label: t("insights.ch.wishlist") });
    }
    if ((ph.deposits?.length ?? 0) > 0 || (ph.open ?? 0) > 0 || (ph.cancellations ?? 0) > 0) {
      out.push({ id: "ch-preorders", roman: "XI", label: t("insights.ch.preorders") });
    }
    if ((insights.collection_dna ?? []).length > 0) {
      out.push({ id: "ch-dna", roman: "XII", label: t("insights.ch.dna") });
    }
  }
  return out;
}

/** Colophon — printed-book footer. */
function Colophon({ t, pieces, year }) {
  return (
    <footer className="mt-20 pt-8 border-t border-[var(--color-or)]/15 text-center">
      <p className="display italic text-sm text-[var(--color-or-pale)]/60">
        {t("stats.colophon.composed", { pieces, year })}
      </p>
      <p className="micro-tight mt-2 opacity-70">{t("stats.colophon.signoff")}</p>
    </footer>
  );
}

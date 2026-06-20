import { useMemo } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { Printer } from "lucide-react";
import { useT } from "../i18n/index.jsx";
import { useMe } from "../hooks/useMe.js";
import { useYearInReview } from "../hooks/useActivity.js";
import { useInsights } from "../hooks/useStats.js";
import AppShell from "../components/AppShell.jsx";
import PageSkeleton from "../components/Skeleton.jsx";
import CountUp from "../components/CountUp.jsx";
import { PageLayout } from "../components/layout/index.js";
import { Button, EmptyState } from "../components/ui/index.js";

import YearSelector from "./year-in-review/YearSelector.jsx";
import Frontispiece from "./year-in-review/Frontispiece.jsx";
import HighlightsSection from "./year-in-review/HighlightsSection.jsx";
import LedgerSection from "./year-in-review/LedgerSection.jsx";
import BookendsSection from "./year-in-review/BookendsSection.jsx";
import CompareSection from "./year-in-review/CompareSection.jsx";
import { mix, ACCENT_GOLD, ACCENT_RED } from "./year-in-review/shared.jsx";

/**
 * /insights/year(/:year) — Rétrospective.
 *
 * Thin orchestrator: auth guard → resolve the year from the URL → fetch the
 * recap (`useYearInReview`) + the set of years the user has data in
 * (`useInsights().spend_by_year`) → compose the editorial spread out of
 * page-local sections. Year switching is deep-linked (navigate to
 * /insights/year/:year) so every recap is a shareable URL, and the page is
 * print-friendly — the only chrome that hides in print is the toolbar.
 *
 * Direction A (shōjo-noir): a `PageLayout` editorial header (kicker · 年 ·
 * AccentTitle · gold-rule), then a frontispiece (masthead year numeral + tally
 * + StatCards), then `Card`/`StatCard` chapters. Gold = value/spend, hanko-red
 * = loss, jade = the calm accent for favourites + the ledger peak.
 */

const CURRENT_YEAR = new Date().getFullYear();

/** Years selectable in the switcher: every year the user spent in, plus the
 *  current year and the year being viewed, newest first. Always non-empty. */
function useSelectableYears(viewed, insights) {
  return useMemo(() => {
    const set = new Set([CURRENT_YEAR, viewed]);
    for (const row of insights?.spend_by_year ?? []) {
      const y = Number(row.year);
      if (Number.isFinite(y)) set.add(y);
    }
    return [...set].sort((a, b) => b - a);
  }, [viewed, insights]);
}

export default function YearInReviewPage() {
  const params = useParams();
  const year = Number.parseInt(params.year ?? CURRENT_YEAR, 10);
  const t = useT();
  const navigate = useNavigate();
  const me = useMe();
  const yir = useYearInReview(year);
  const insights = useInsights();
  const years = useSelectableYears(year, insights.data);

  if (me.isLoading) return null;
  if (!me.data?.authenticated) return <Navigate to="/login" replace />;

  const goYear = (y) => navigate(`/insights/year/${y}`);

  const data = yir.data;
  const isEmpty = !yir.isLoading && (yir.error || !data || data.pieces_acquired === 0);

  const toolbar = (
    <div className="flex items-center gap-2 flex-wrap print:hidden">
      <YearSelector
        years={years}
        current={year}
        onSelect={goYear}
        label={t("yir.select_year", { default: "Choisir l'année" })}
      />
      <Button
        variant="ghost"
        size="sm"
        onClick={() => window.print()}
        iconStart={<Printer size={15} strokeWidth={1.75} />}
        className="uppercase"
      >
        {t("yir.print")}
      </Button>
    </div>
  );

  return (
    <AppShell>
      <PageLayout
        kicker={t("yir.kicker", {
          year,
          default: "ANALYSES · 年 · RÉTROSPECTIVE {year}",
        })}
        title={t("yir.almanach.statement", {
          default: "Bilan d'une année de collection.",
        })}
        kanji="年"
        width="standard"
        toolbar={toolbar}
      >
        {/* Editorial frontispiece numeral — the dramatic masthead year, kept
            as the page's hero figure but rendered GPU-light (static type). */}
        <div className="flex items-end justify-between gap-6 flex-wrap -mt-2 mb-2">
          <h2
            aria-hidden
            className="figural display-italic text-[clamp(4rem,12vw,9rem)] leading-[0.82] text-[var(--on-surface)]"
          >
            {year}
          </h2>
          <span
            className="micro-tight self-center px-2 py-0.5 border tracking-[0.3em] shrink-0"
            style={{
              borderColor: mix(ACCENT_RED, 55),
              color: ACCENT_RED,
              background: mix(ACCENT_GOLD, 6),
            }}
          >
            Nº {year}
          </span>
        </div>

        {yir.isLoading ? (
          <PageSkeleton blocks={4} />
        ) : isEmpty ? (
          <EmptyState
            kanji="空"
            eyebrow={t("yir.empty.eyebrow", { default: "Année blanche" })}
            title={t("yir.no_data")}
            body={t("yir.empty.body", {
              default: "Aucune pièce, dépense ou pré-commande sur cette année.",
            })}
          >
            {years.length > 1 ? (
              <p className="micro-tight normal-case tracking-[0.18em] text-[var(--on-surface-muted)]">
                {t("yir.empty.hint", {
                  default: "Choisissez une autre année ci-dessus.",
                })}
              </p>
            ) : null}
          </EmptyState>
        ) : (
          <>
            <Frontispiece data={data} t={t} />
            <HighlightsSection data={data} t={t} />
            <LedgerSection data={data.monthly_pieces ?? []} t={t} />
            <BookendsSection first={data.first_acquisition} last={data.last_acquisition} t={t} />
            <CompareSection data={data} t={t} />

            {/* Edition footer — quiet provenance line, kept in print. */}
            <p
              className="mt-12 pt-6 border-t micro-tight normal-case tracking-[0.18em] text-[var(--on-surface-subtle)] flex flex-wrap items-baseline gap-x-3 gap-y-1"
              style={{ borderColor: mix(ACCENT_GOLD, 15) }}
            >
              <span className="display italic text-[var(--color-or-pale)] normal-case tracking-normal text-base">
                FigureCollector
              </span>
              <span aria-hidden>·</span>
              <span>{t("yir.edition", { year, default: "Rétrospective {year}" })}</span>
              <span aria-hidden>·</span>
              <span>
                <CountUp value={data.pieces_acquired} /> {t("yir.pieces.label")}
              </span>
            </p>
          </>
        )}
      </PageLayout>
    </AppShell>
  );
}

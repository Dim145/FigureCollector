import { Link, Navigate, useParams } from "react-router-dom";
import { useT } from "../i18n/index.jsx";
import { useMe } from "../hooks/useMe.js";
import { useYearInReview } from "../hooks/useActivity.js";
import AppShell from "../components/AppShell.jsx";

/**
 * /year-in-review/:year — L'Almanach.
 *
 * Once-a-year retrospective. Reads like a printed almanac: a massive
 * italic year as the masthead, a layered kanji watermark behind it
 * (年 + 録), an opening sentence in display serif, an asymmetric stat
 * tableau (the spend cell takes a tall left column), a 12-month ledger
 * bar chart with the peak month highlighted, and a pair of bookend
 * cards for first/last acquisitions of the year. The lacquer accent
 * (oxblood red) calls in for the "longest slip" cell and the masthead's
 * Nº stamp, so this page reads as a different chapter from the gold-led
 * pages elsewhere in the app.
 *
 * Print mode hides the decorative kanji + year navigation; the rest
 * flattens to a poster you can save as PDF.
 */

const CURRENT_YEAR = new Date().getFullYear();

export default function YearInReviewPage() {
  const params = useParams();
  const year = Number.parseInt(params.year ?? CURRENT_YEAR, 10);
  const t = useT();
  const me = useMe();
  const yir = useYearInReview(year);

  if (me.isLoading) return null;
  if (!me.data?.authenticated) return <Navigate to="/login" replace />;

  if (yir.isLoading) {
    return (
      <AppShell>
        <div className="text-center py-16 text-[var(--color-ivoire-soft)]">…</div>
      </AppShell>
    );
  }

  if (yir.error || !yir.data) {
    return (
      <AppShell>
        <main className="max-w-md mx-auto px-6 py-16 text-center">
          <p className="display text-2xl text-[var(--color-ivoire)]">{year}</p>
          <p className="mt-2 text-[var(--color-ivoire-soft)]">{t("yir.no_data")}</p>
          <YearNavigation year={year} t={t} />
        </main>
      </AppShell>
    );
  }

  const data = yir.data;
  const empty = data.pieces_acquired === 0;

  return (
    <AppShell>
      <main className="almanac max-w-5xl mx-auto px-6 pt-4 pb-12 print:py-4">
        <Masthead year={year} t={t} />

        {empty ? (
          <EmptyYear t={t} />
        ) : (
          <>
            <Opening count={data.pieces_acquired} t={t} />

            <Tableau data={data} t={t} />

            <Ledger data={data.monthly_pieces ?? []} t={t} />

            {data.first_acquisition || data.last_acquisition ? (
              <Bookends
                first={data.first_acquisition}
                last={data.last_acquisition}
                t={t}
              />
            ) : null}
          </>
        )}

        <YearNavigation year={year} t={t} />
      </main>
    </AppShell>
  );
}

// =============================================================================
// Masthead — Nº · L'ALMANACH · Bilan + huge year
// =============================================================================

function Masthead({ year, t }) {
  return (
    <header className="almanac-masthead">
      <div className="almanac-masthead-left">
        <p className="almanac-masthead-eyebrow">
          {t("yir.almanach.eyebrow")}
          <span className="almanac-masthead-stamp">Nº {year}</span>
        </p>
        <h1 className="almanac-masthead-year">{year}</h1>
        <p className="almanac-masthead-sub">{t("yir.subtitle")}</p>
      </div>
      <div className="almanac-masthead-right">
        <p>FigureCollector</p>
        <p style={{ marginTop: "0.5rem", opacity: 0.65 }}>
          {new Date().toLocaleDateString(undefined, {
            day: "2-digit",
            month: "long",
            year: "numeric",
          })}
        </p>
      </div>
    </header>
  );
}

// =============================================================================
// Opening — italic display-serif sentence with the count inline
// =============================================================================

function Opening({ count, t }) {
  // Use the n-aware key so singular/plural read naturally.
  const phrase =
    count === 1
      ? t("yir.almanach.opening", { n: count })
      : t("yir.almanach.opening_many", { n: count });

  // Highlight the number itself by splitting around it — keeps the
  // typographic emphasis in the sentence flow rather than as a separate
  // hero block. The pattern "Cette année, X pièce(s)..." → wrap "X".
  const parts = phrase.split(String(count));
  return (
    <section className="almanac-opening">
      <p className="almanac-opening-line">
        {parts[0]}
        <span className="almanac-opening-count">{count}</span>
        {parts[1]}
      </p>
      <span className="almanac-opening-rule" aria-hidden />
    </section>
  );
}

// =============================================================================
// Stat tableau — asymmetric grid
// =============================================================================

function Tableau({ data, t }) {
  const hasSpend = (data.spend_by_currency ?? []).length > 0;

  return (
    <section className="almanac-tableau">
      {/* DÉPENSES — tall left column */}
      <div className="almanac-cell almanac-cell--wide" data-mark="銭">
        <span className="almanac-cell-label">{t("yir.spend.label")}</span>
        {hasSpend ? (
          <ul className="almanac-spend-list">
            {data.spend_by_currency.map((s) => (
              <li key={s.currency} className="almanac-spend-row">
                <span className="almanac-spend-currency">{s.currency}</span>
                <span className="almanac-spend-total">
                  {Number(s.total).toLocaleString(undefined, {
                    minimumFractionDigits: 0,
                    maximumFractionDigits: 2,
                  })}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="almanac-cell-headline is-muted">
            {t("yir.spend.empty")}
          </p>
        )}
      </div>

      {/* FABRICANT FAVORI */}
      <div className="almanac-cell almanac-cell--top" data-mark="工">
        <span className="almanac-cell-label">
          {t("yir.top_manufacturer.label")}
        </span>
        {data.top_manufacturer ? (
          <>
            <p className="almanac-cell-headline">
              {data.top_manufacturer.name}
            </p>
            <span className="almanac-cell-aside">
              × {data.top_manufacturer.count}
            </span>
          </>
        ) : (
          <p className="almanac-cell-headline is-muted">—</p>
        )}
      </div>

      {/* SÉRIE FAVORITE */}
      <div className="almanac-cell almanac-cell--bot" data-mark="物">
        <span className="almanac-cell-label">{t("yir.top_series.label")}</span>
        {data.top_series ? (
          <>
            <p className="almanac-cell-headline">{data.top_series.name}</p>
            <span className="almanac-cell-aside">× {data.top_series.count}</span>
          </>
        ) : (
          <p className="almanac-cell-headline is-muted">—</p>
        )}
      </div>

      {/* LONGEST SLIP — full width, lacquer accent */}
      {data.longest_slip ? (
        <div
          className="almanac-cell almanac-cell--full almanac-slip"
          data-mark="遅"
        >
          <span className="almanac-cell-label">
            {t("yir.longest_slip.label")}
          </span>
          <p className="almanac-cell-headline">
            {data.longest_slip.figure_name}
          </p>
          <p className="almanac-slip-detail">
            {data.longest_slip.slip_count === 1
              ? t("yir.longest_slip.detail_one", {
                  from: data.longest_slip.original_date ?? "?",
                  to: data.longest_slip.current_date ?? "?",
                })
              : t("yir.longest_slip.detail", {
                  slips: data.longest_slip.slip_count,
                  from: data.longest_slip.original_date ?? "?",
                  to: data.longest_slip.current_date ?? "?",
                })}
          </p>
        </div>
      ) : null}
    </section>
  );
}

// =============================================================================
// Monthly ledger — bar chart with peak highlighted
// =============================================================================

function Ledger({ data, t }) {
  const counts = new Array(12).fill(0);
  for (const m of data) {
    if (m.month >= 1 && m.month <= 12) counts[m.month - 1] = m.count;
  }
  const max = Math.max(1, ...counts);
  const total = counts.reduce((a, b) => a + b, 0);
  const peakMonth = counts.indexOf(max) + 1; // 1-12

  return (
    <section className="almanac-ledger">
      <header className="almanac-ledger-head">
        <h2 className="almanac-ledger-title">{t("yir.timeline.title")}</h2>
        <div className="almanac-ledger-meta">
          <span>
            {t("yir.timeline.peak")}{" "}
            <span className="almanac-ledger-meta-value">
              {t(`yir.month.${peakMonth}`)} ({max})
            </span>
          </span>
          <span>
            {t("yir.timeline.total")}{" "}
            <span className="almanac-ledger-meta-value">{total}</span>
          </span>
        </div>
      </header>

      <div className="almanac-ledger-grid">
        {counts.map((c, i) => {
          const isPeak = c === max && c > 0;
          const isEmpty = c === 0;
          const heightPct = isEmpty ? 0 : (c / max) * 100;
          return (
            <div
              key={i}
              className={`almanac-ledger-month ${isPeak ? "is-peak" : ""}`}
            >
              <div className="almanac-ledger-bar-wrap">
                {c > 0 ? (
                  <span
                    className={`almanac-ledger-count ${isPeak ? "is-peak" : ""}`}
                  >
                    {c}
                  </span>
                ) : null}
                <span
                  className={`almanac-ledger-bar ${
                    isPeak ? "is-peak" : ""
                  } ${isEmpty ? "is-empty" : ""}`}
                  style={{
                    height: isEmpty ? undefined : `${heightPct}%`,
                    "--i": i,
                  }}
                />
              </div>
              <span className="almanac-ledger-label">
                {t(`yir.month.${i + 1}`)}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// =============================================================================
// Bookends — first / last acquisition
// =============================================================================

function Bookends({ first, last, t }) {
  return (
    <section className="almanac-bookends">
      <header className="almanac-bookends-head">
        <h2 className="almanac-ledger-title">{t("yir.bookends.title")}</h2>
      </header>
      <div className="almanac-bookends-grid">
        {first ? (
          <article className="almanac-bookend almanac-bookend--first">
            <span className="almanac-bookend-eyebrow">
              {t("yir.first_acquisition")}
            </span>
            <span className="almanac-bookend-name">{first.figure_name}</span>
            <time className="almanac-bookend-date">
              {new Date(first.at).toLocaleDateString()}
            </time>
          </article>
        ) : null}
        {last ? (
          <article className="almanac-bookend almanac-bookend--last">
            <span className="almanac-bookend-eyebrow">
              {t("yir.last_acquisition")}
            </span>
            <span className="almanac-bookend-name">{last.figure_name}</span>
            <time className="almanac-bookend-date">
              {new Date(last.at).toLocaleDateString()}
            </time>
          </article>
        ) : null}
      </div>
    </section>
  );
}

// =============================================================================
// Empty state — when the year has zero activity
// =============================================================================

function EmptyYear({ t }) {
  return (
    <section className="almanac-opening">
      <p className="almanac-opening-line">{t("yir.no_data")}</p>
      <span className="almanac-opening-rule" aria-hidden />
    </section>
  );
}

// =============================================================================
// Year navigation — prev / print / next
// =============================================================================

function YearNavigation({ year, t }) {
  return (
    <nav className="almanac-nav print:hidden">
      <Link className="almanac-nav-link" to={`/year-in-review/${year - 1}`}>
        ← {t("yir.prev")} ({year - 1})
      </Link>
      <button
        type="button"
        onClick={() => window.print()}
        className="almanac-nav-print"
      >
        ⎙ {t("yir.print")}
      </button>
      {year < CURRENT_YEAR ? (
        <Link className="almanac-nav-link" to={`/year-in-review/${year + 1}`}>
          {t("yir.next")} ({year + 1}) →
        </Link>
      ) : (
        <span aria-hidden />
      )}
    </nav>
  );
}

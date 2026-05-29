import { useEffect, useRef, useState } from "react";
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
      {/* Localized hero colour-wash — a warm celebratory bloom behind the
       *  masthead so the recap opens like a festival poster rather than a
       *  ledger. Absolute + pointer-events-none, low-alpha accent vars only,
       *  so it tints without flooding and flips with the light/dark theme.
       *  The masthead is position:relative + overflow:hidden, and its
       *  `> *` rule lifts real content to z-1, so this first-child layer
       *  paints safely underneath. Hidden in print to keep the PDF clean. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 print:hidden"
        style={{
          background:
            "radial-gradient(70% 90% at 12% 110%, color-mix(in oklab, var(--color-neon-amber) 16%, transparent), transparent 68%), radial-gradient(60% 80% at 95% -10%, color-mix(in oklab, var(--color-neon-magenta) 13%, transparent), transparent 70%), radial-gradient(55% 70% at 60% 50%, color-mix(in oklab, var(--color-indigo) 10%, transparent), transparent 72%)",
        }}
      />
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
          {new Date().toLocaleDateString(document.documentElement.lang || undefined, {
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
    <Reveal as="section" className="almanac-opening" i={0}>
      <p className="almanac-opening-line">
        {parts[0]}
        {/* The headline count is the emotional centre of the recap — lift it
         *  from gold to a warm amber so the year's tally reads as a
         *  celebration. CSS-var only → theme-correct. */}
        <span
          className="almanac-opening-count"
          style={{
            color: "var(--color-neon-amber)",
            textShadow:
              "0 0 28px color-mix(in oklab, var(--color-neon-amber) 35%, transparent)",
          }}
        >
          <Counter value={count} />
        </span>
        {parts[1]}
      </p>
      <span className="almanac-opening-rule" aria-hidden />
    </Reveal>
  );
}

// =============================================================================
// Stat tableau — asymmetric grid
// =============================================================================

function Tableau({ data, t }) {
  const hasSpend = (data.spend_by_currency ?? []).length > 0;
  const hasLosses = (data.cancellation_losses ?? []).length > 0;

  return (
    <section className="almanac-tableau">
      {/* DÉPENSES — wider left cell, count-up animation per currency.
       *  Now also surfaces the "Pertes sur annulations" sub-block beneath
       *  the spending list when the year had at least one cancelled
       *  preorder with an unrecovered deposit. Painted in laque-red so it
       *  doesn't get confused with regular spending. */}
      <Reveal className="almanac-cell almanac-cell--wide" data-mark="銭" i={0}>
        <span className="almanac-cell-label">{t("yir.spend.label")}</span>
        {hasSpend ? (
          <ul className="almanac-spend-list">
            {data.spend_by_currency.map((s) => (
              <li key={s.currency} className="almanac-spend-row">
                <span className="almanac-spend-currency">{s.currency}</span>
                <span className="almanac-spend-total">
                  <Counter value={Number(s.total)} decimals={2} />
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="almanac-cell-headline is-muted">
            {t("yir.spend.empty")}
          </p>
        )}
        {hasLosses ? (
          <div className="almanac-losses">
            <span className="almanac-losses-label">
              {t("yir.losses.label")}
            </span>
            <ul className="almanac-spend-list">
              {data.cancellation_losses.map((s) => (
                <li
                  key={`loss-${s.currency}`}
                  className="almanac-spend-row almanac-spend-row--loss"
                >
                  <span className="almanac-spend-currency">{s.currency}</span>
                  <span className="almanac-spend-total">
                    − <Counter value={Number(s.total)} decimals={2} />
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </Reveal>

      {/* FABRICANT FAVORI — jade accent in the rhythm. */}
      <Reveal className="almanac-cell almanac-cell--top" data-mark="工" i={1}>
        <span className="almanac-cell-label">
          {t("yir.top_manufacturer.label")}
        </span>
        {data.top_manufacturer ? (
          <>
            <p
              className="almanac-cell-headline"
              style={{ color: "var(--color-jade)" }}
            >
              {data.top_manufacturer.name}
            </p>
            <span
              className="almanac-cell-aside"
              style={{ color: "var(--color-jade)", opacity: 1 }}
            >
              × <Counter value={data.top_manufacturer.count} />
            </span>
          </>
        ) : (
          <p className="almanac-cell-headline is-muted">—</p>
        )}
      </Reveal>

      {/* SÉRIE FAVORITE — indigo accent in the rhythm. */}
      <Reveal className="almanac-cell almanac-cell--bot" data-mark="物" i={2}>
        <span className="almanac-cell-label">{t("yir.top_series.label")}</span>
        {data.top_series ? (
          <>
            <p
              className="almanac-cell-headline"
              style={{ color: "var(--color-indigo)" }}
            >
              {data.top_series.name}
            </p>
            <span
              className="almanac-cell-aside"
              style={{ color: "var(--color-indigo)", opacity: 1 }}
            >
              × <Counter value={data.top_series.count} />
            </span>
          </>
        ) : (
          <p className="almanac-cell-headline is-muted">—</p>
        )}
      </Reveal>

      {/* LONGEST SLIP — full width, lacquer accent */}
      {data.longest_slip ? (
        <Reveal
          className="almanac-cell almanac-cell--full almanac-slip"
          data-mark="遅"
          i={3}
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
        </Reveal>
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
    <Reveal as="section" className="almanac-ledger">
      <header className="almanac-ledger-head">
        <h2 className="almanac-ledger-title">{t("yir.timeline.title")}</h2>
        <div className="almanac-ledger-meta">
          <span>
            {t("yir.timeline.peak")}{" "}
            {/* Peak month gets the cyan accent so it pops out of the gold
             *  meta line as the year's high-water mark. */}
            <span
              className="almanac-ledger-meta-value"
              style={{ color: "var(--color-neon-cyan)" }}
            >
              {t(`yir.month.${peakMonth}`)} (
              <Counter value={max} />)
            </span>
          </span>
          <span>
            {t("yir.timeline.total")}{" "}
            <span className="almanac-ledger-meta-value">
              <Counter value={total} />
            </span>
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
                    style={
                      isPeak ? { color: "var(--color-neon-cyan)" } : undefined
                    }
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
                    // The peak column glows cyan instead of gold so the
                    // year's busiest month is unmistakable. Bar entrance is
                    // still the CSS scaleY grow keyed off --i. Vars only.
                    ...(isPeak
                      ? {
                          background:
                            "linear-gradient(180deg, var(--color-neon-cyan) 0%, color-mix(in oklab, var(--color-neon-cyan) 55%, transparent) 100%)",
                          boxShadow:
                            "0 -8px 24px -8px color-mix(in oklab, var(--color-neon-cyan) 60%, transparent)",
                        }
                      : null),
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
    </Reveal>
  );
}

// =============================================================================
// Bookends — first / last acquisition
// =============================================================================

function Bookends({ first, last, t }) {
  return (
    <Reveal as="section" className="almanac-bookends">
      <header className="almanac-bookends-head">
        <h2 className="almanac-ledger-title">{t("yir.bookends.title")}</h2>
      </header>
      <div className="almanac-bookends-grid">
        {first ? (
          // Bookends are colour-coded as a pair: the year's first piece opens
          // in jade, the last closes in magenta — the top rule carries the
          // accent so the names stay legible ink. Vars only → theme-correct.
          <Reveal
            as="article"
            className="almanac-bookend almanac-bookend--first"
            i={0}
            style={{ borderTopColor: "var(--color-jade)" }}
          >
            <span className="almanac-bookend-eyebrow">
              {t("yir.first_acquisition")}
            </span>
            <span className="almanac-bookend-name">{first.figure_name}</span>
            <time className="almanac-bookend-date">
              {new Date(first.at).toLocaleDateString()}
            </time>
          </Reveal>
        ) : null}
        {last ? (
          <Reveal
            as="article"
            className="almanac-bookend almanac-bookend--last"
            i={1}
            style={{ borderTopColor: "var(--color-neon-magenta)" }}
          >
            <span className="almanac-bookend-eyebrow">
              {t("yir.last_acquisition")}
            </span>
            <span className="almanac-bookend-name">{last.figure_name}</span>
            <time className="almanac-bookend-date">
              {new Date(last.at).toLocaleDateString()}
            </time>
          </Reveal>
        ) : null}
      </div>
    </Reveal>
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

// =============================================================================
// Animation primitives
// =============================================================================

/** Animates a number from 0 to `target` on mount with an ease-out-cubic
 *  curve. Returns the current value as a number; consumers format it
 *  however they want. Honours prefers-reduced-motion. */
function useCountUp(target, duration = 1400, deps = []) {
  const [value, setValue] = useState(() => {
    if (typeof window !== "undefined" &&
        window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      return target;
    }
    return 0;
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setValue(target);
      return;
    }
    const targetNum = Number(target) || 0;
    let raf;
    let start;
    const step = (ts) => {
      if (!start) start = ts;
      const elapsed = ts - start;
      const t = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(targetNum * eased);
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => raf && cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, duration, ...deps]);
  return value;
}

/** Flips a `.is-revealed` class on the referenced element once it scrolls
 *  into view. One-shot: doesn't unmark when the user scrolls back up,
 *  since these are page-load reveals not state indicators. */
function useReveal(ref, options = {}) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Reduced-motion users skip the choreography — reveal immediately.
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      el.classList.add("is-revealed");
      return;
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          el.classList.add("is-revealed");
          io.disconnect();
        }
      },
      { threshold: 0.18, rootMargin: "0px 0px -10% 0px", ...options },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref, options]);
}

/** Wraps children in an element with .almanac-reveal so the
 *  IntersectionObserver reveal kicks in. `i` drives the stagger via
 *  inline --i. Pass `as="section"` etc to change the underlying tag. */
function Reveal({ i = 0, as: As = "div", className = "", style, children, ...rest }) {
  const ref = useRef(null);
  useReveal(ref);
  return (
    <As
      ref={ref}
      className={`almanac-reveal ${className}`}
      style={{ "--i": i, ...style }}
      {...rest}
    >
      {children}
    </As>
  );
}

/** Formats a number the way the rest of the app does — locale-aware, no
 *  trailing zeros unless they're significant. Wraps `Number.prototype.toLocaleString`. */
function fmtNumber(n, maxFrac = 2) {
  return Number(n).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxFrac,
  });
}

/** Inline counter span — animates from 0 to `value` then settles. */
function Counter({ value, decimals = 0, className = "" }) {
  const animated = useCountUp(value, 1400, [value]);
  // For integer-only counters we floor while animating; for decimals we
  // round to the requested places so the number doesn't jitter through
  // weird intermediate fractions.
  const display = decimals === 0
    ? Math.round(animated)
    : Number(animated.toFixed(decimals));
  return <span className={className}>{fmtNumber(display, decimals)}</span>;
}

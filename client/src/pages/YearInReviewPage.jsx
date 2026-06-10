import { Link, Navigate, useParams } from "react-router-dom";
import { useT } from "../i18n/index.jsx";
import { appLocale } from "../lib/locale.js";
import { useMe } from "../hooks/useMe.js";
import { useYearInReview } from "../hooks/useActivity.js";
import { fmtMoney } from "../lib/money.js";
import AppShell from "../components/AppShell.jsx";
import AccentTitle from "../components/AccentTitle.jsx";
import Card from "../components/Card.jsx";
import StatCard from "../components/StatCard.jsx";
import CountUp from "../components/CountUp.jsx";
import Reveal from "../components/motion/Reveal.jsx";

/**
 * /year-in-review/:year — Le Bilan.
 *
 * Annual recap brought fully into Direction A (shōjo-noir): a calm,
 * celebratory editorial spread. The dramatic almanac idea is kept — a
 * massive italic Fraunces year as the masthead — but rendered in the A
 * vocabulary: a `KICKER · 暦 · {year}` micro-label, an `<AccentTitle>`
 * red-accent statement, a gold-rule, and a faint 暦 kanji-mark bleeding
 * off the corner. The recap reads as a stat strip (`StatCard`s) followed
 * by `Card` "chapters", each opened by a kicker sub-label + accent
 * hairline + kanji section marker.
 *
 * Colour code (tokens only): gold (金) carries value/spend, hanko-red
 * (朱) carries losses on cancellations, jade is the calm third accent for
 * favourites/openings. The monthly ledger keeps its data and the peak
 * highlight, retheme'd from gold bars to a jade high-water mark.
 *
 * Print mode hides the decorative kanji-mark + year navigation; the rest
 * flattens to a poster you can save as PDF.
 */

const CURRENT_YEAR = new Date().getFullYear();

/** color-mix helper — keeps accent translucency in oklab, theme-var safe. */
function mix(accentVar, pct) {
  return `color-mix(in oklab, ${accentVar} ${pct}%, transparent)`;
}

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

  if (yir.error || !yir.data) {
    return (
      <AppShell>
        <main className="max-w-5xl mx-auto px-6 pt-4 pb-12 print:py-4">
          <Masthead year={year} t={t} />
          <Card className="max-w-xl mx-auto p-12 text-center mt-12">
            <p className="text-[var(--color-ivoire-soft)] italic">
              {t("yir.no_data")}
            </p>
          </Card>
          <YearNavigation year={year} t={t} />
        </main>
      </AppShell>
    );
  }

  const data = yir.data;
  const empty = data.pieces_acquired === 0;

  return (
    <AppShell>
      <main className="relative max-w-5xl mx-auto px-6 pt-6 pb-16 print:py-4">
        <Masthead year={year} t={t} />

        {empty ? (
          <EmptyYear t={t} />
        ) : (
          <>
            <Opening data={data} t={t} />

            <StatStrip data={data} t={t} />

            <SpendChapter data={data} t={t} />

            <FavouritesChapter data={data} t={t} />

            {data.longest_slip ? <SlipChapter data={data} t={t} /> : null}

            <Ledger data={data.monthly_pieces ?? []} t={t} />

            {data.first_acquisition || data.last_acquisition ? (
              <Bookends
                first={data.first_acquisition}
                last={data.last_acquisition}
                t={t}
              />
            ) : null}

            <YearCompare data={data} t={t} />
          </>
        )}

        <YearNavigation year={year} t={t} />
      </main>
    </AppShell>
  );
}

// =============================================================================
// Masthead — editorial-A almanac: kicker (BILAN · 暦 · {year}) + huge italic
// year + red-accent statement + gold-rule, with a faint 暦 kanji-mark.
// =============================================================================

function Masthead({ year, t }) {
  return (
    <header className="relative pt-4 pb-10 mb-2 border-b border-[var(--color-or)]/20 overflow-hidden">
      {/* Faint 暦 (calendar / almanac) watermark bleeding off the right edge —
          the signature A kanji-mark. Hidden in print to keep the PDF clean. */}
      <span
        aria-hidden
        className="kanji-mark text-[22rem] md:text-[30rem] -top-24 -right-10 print:hidden"
      >
        暦
      </span>

      <div className="relative grid grid-cols-1 md:grid-cols-[1fr_auto] gap-6 items-end">
        <div className="min-w-0">
          <p className="micro inline-flex items-center gap-3">
            <span
              aria-hidden
              className="inline-block w-8 h-px"
              style={{ background: "var(--color-or)" }}
            />
            {t("yir.almanach.eyebrow")}
            <span aria-hidden className="ja text-[var(--color-or-pale)]/80">
              暦
            </span>
            <span
              className="inline-block px-2 py-0.5 border tracking-[0.3em]"
              style={{
                borderColor: mix("var(--color-laque-bright)", 55),
                color: "var(--color-laque-bright)",
                background: mix("var(--color-laque)", 8),
              }}
            >
              Nº {year}
            </span>
          </p>

          {/* The dramatic year-masthead, kept — big italic Fraunces oldstyle
              numerals. This is the page's hero figure. */}
          <h1 className="figural display-italic text-[clamp(5rem,15vw,11rem)] leading-[0.82] mt-5 text-[var(--color-ivoire)]">
            {year}
          </h1>

          {/* Red-accent statement — AccentTitle lifts the leading word into
              hanko-red italic, the signature A headline move. */}
          <p className="display text-2xl md:text-3xl mt-4 text-[var(--color-ivoire)] leading-tight">
            <AccentTitle text={t("yir.almanach.statement", { default: "Bilan d'une année de collection." })} />
          </p>

          <div className="gold-rule w-24 mt-6" />
        </div>

        <div className="md:text-right shrink-0 print:block">
          <p className="display italic text-lg text-[var(--color-or-pale)]/80">
            FigureCollector
          </p>
          <p className="micro-tight mt-2 normal-case tracking-[0.18em] text-[var(--color-ivoire-soft)]/60">
            {new Date().toLocaleDateString(
              document.documentElement.lang || undefined,
              { day: "2-digit", month: "long", year: "numeric" },
            )}
          </p>
        </div>
      </div>
    </header>
  );
}

// =============================================================================
// Opening — editorial display sentence, the year's tally lifted to gold.
// =============================================================================

function Opening({ data, t }) {
  const count = data.pieces_acquired;
  const phrase =
    count === 1
      ? t("yir.almanach.opening", { n: count })
      : t("yir.almanach.opening_many", { n: count });

  // Split around the number so the tally keeps its emphasis inside the
  // sentence flow rather than as a separate hero block.
  const parts = phrase.split(String(count));
  return (
    <Reveal as="section" className="mt-10" y={20}>
      <p className="display text-2xl md:text-3xl leading-snug text-[var(--color-ivoire-soft)]">
        {parts[0]}
        {/* The headline count is the emotional centre of the recap. It is a
            value figure, so it reads in gold (金) — never a status colour. */}
        <span className="figural text-[var(--color-or)] mx-1">
          <CountUp value={count} />
        </span>
        {parts[1]}
      </p>
      <div className="gold-rule w-16 mt-6" />
    </Reveal>
  );
}

// =============================================================================
// Stat strip — figurine metrics right under the header. Gold = value/spend,
// hanko-red = losses on cancellations, ivoire default for counts.
// =============================================================================

function StatStrip({ data, t }) {
  const spend = (data.spend_by_currency ?? [])[0] ?? null;
  const losses = (data.cancellation_losses ?? [])[0] ?? null;
  const months = data.monthly_pieces ?? [];
  let peakCount = 0;
  for (const m of months) {
    const c = Number(m.count) || 0;
    if (c > peakCount) peakCount = c;
  }

  return (
    <Reveal as="div" y={22} className="mt-10 grid grid-cols-2 lg:grid-cols-4 gap-3">
      <StatCard label={t("yir.pieces.label")} value={data.pieces_acquired} />
      <StatCard
        label={t("yir.spend.label")}
        value={spend ? fmtMoney(Number(spend.total), spend.currency) : "—"}
        sub={spend ? spend.currency : t("yir.spend.empty")}
        tone="gold"
      />
      <StatCard
        label={t("yir.losses.label")}
        value={losses ? `− ${fmtMoney(Number(losses.total), losses.currency)}` : "—"}
        sub={losses ? losses.currency : t("yir.losses.none", { default: "Aucune perte" })}
        tone={losses ? "red" : undefined}
      />
      <StatCard
        label={t("yir.timeline.peak")}
        value={peakCount}
        sub={t("yir.peak.unit", { default: "pièces / mois" })}
      />
    </Reveal>
  );
}

// =============================================================================
// Chapter — a Card opened by a kicker sub-label + accent hairline + kanji
// section marker. The shared editorial "chapter" wrapper for this page.
// =============================================================================

function Chapter({ kicker, kanji, accent = "var(--color-or)", className = "", children, i = 0 }) {
  return (
    <Reveal as="div" y={24} delay={i * 0.04} className="mt-8">
      <Card className={`relative p-7 overflow-hidden ${className}`}>
        {/* Faint kanji section marker in the corner. */}
        {kanji ? (
          <span
            aria-hidden
            className="ja absolute -top-3 right-4 text-[5.5rem] leading-none select-none pointer-events-none"
            style={{ color: mix(accent, 12) }}
          >
            {kanji}
          </span>
        ) : null}
        <p className="micro relative inline-flex items-center gap-2">
          <span
            aria-hidden
            className="inline-block w-5 h-px"
            style={{ background: mix(accent, 80) }}
          />
          {kicker}
        </p>
        <div className="relative mt-4">{children}</div>
      </Card>
    </Reveal>
  );
}

// =============================================================================
// Dépenses + Pertes sur annulations — gold for spend, hanko-red for losses.
// =============================================================================

function SpendChapter({ data, t }) {
  const spend = data.spend_by_currency ?? [];
  const losses = data.cancellation_losses ?? [];
  const hasSpend = spend.length > 0;
  const hasLosses = losses.length > 0;

  return (
    <Chapter kicker={t("yir.spend.label")} kanji="銭" accent="var(--color-or)" i={0}>
      {hasSpend ? (
        <ul className="space-y-2.5">
          {spend.map((s) => (
            <li
              key={s.currency}
              className="flex items-baseline justify-between gap-4 py-2 border-b border-dashed border-[var(--color-or)]/15 last:border-b-0"
            >
              <span className="micro-tight">{s.currency}</span>
              <span className="display text-3xl md:text-4xl leading-none text-[var(--color-or)]">
                <CountUp
                  value={Number(s.total)}
                  format={(n) => fmtMoney(n, s.currency)}
                />
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[var(--color-ivoire-soft)] italic">{t("yir.spend.empty")}</p>
      )}

      {hasLosses ? (
        <div
          className="mt-6 pt-5 border-t"
          style={{ borderColor: mix("var(--color-laque-bright)", 28) }}
        >
          <p
            className="micro-tight inline-flex items-center gap-2"
            style={{ color: "var(--color-laque-bright)" }}
          >
            <span
              aria-hidden
              className="inline-block w-4 h-px"
              style={{ background: mix("var(--color-laque-bright)", 75) }}
            />
            {t("yir.losses.label")}
          </p>
          <ul className="mt-2.5 space-y-2">
            {losses.map((s) => (
              <li
                key={`loss-${s.currency}`}
                className="flex items-baseline justify-between gap-4"
              >
                <span
                  className="micro-tight"
                  style={{ color: "var(--color-laque-bright)" }}
                >
                  {s.currency}
                </span>
                <span
                  className="display text-2xl md:text-3xl leading-none"
                  style={{ color: "var(--color-laque-bright)" }}
                >
                  − <CountUp value={Number(s.total)} format={(n) => fmtMoney(n, s.currency)} />
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Chapter>
  );
}

// =============================================================================
// Fabricant + Série favoris — paired jade chapters (the calm third accent).
// =============================================================================

function FavouritesChapter({ data, t }) {
  const items = [
    {
      kicker: t("yir.top_manufacturer.label"),
      kanji: "工",
      entry: data.top_manufacturer,
    },
    {
      kicker: t("yir.top_series.label"),
      kanji: "物",
      entry: data.top_series,
    },
  ];
  return (
    <Reveal as="div" y={24} className="mt-8 grid md:grid-cols-2 gap-4">
      {items.map((it) => (
        <Card key={it.kanji} className="relative p-7 overflow-hidden">
          <span
            aria-hidden
            className="ja absolute -top-3 right-4 text-[5.5rem] leading-none select-none pointer-events-none"
            style={{ color: mix("var(--color-jade)", 12) }}
          >
            {it.kanji}
          </span>
          <p className="micro relative inline-flex items-center gap-2">
            <span
              aria-hidden
              className="inline-block w-5 h-px"
              style={{ background: mix("var(--color-jade)", 80) }}
            />
            {it.kicker}
          </p>
          {it.entry ? (
            <>
              <p
                className="display text-2xl md:text-3xl mt-4 leading-tight"
                style={{ color: "var(--color-jade)" }}
              >
                {it.entry.name}
              </p>
              <p className="micro-tight mt-3 normal-case tracking-[0.18em]">
                ×{" "}
                <span className="figural text-base text-[var(--color-jade)]">
                  <CountUp value={Number(it.entry.count) || 0} />
                </span>{" "}
                {t("yir.fav.pieces", { default: "pièces" })}
              </p>
            </>
          ) : (
            <p className="text-[var(--color-ivoire-soft)] italic mt-4">—</p>
          )}
        </Card>
      ))}
    </Reveal>
  );
}

// =============================================================================
// Sortie la plus repoussée — full-width hanko-red chapter (a "loss" of time).
// =============================================================================

function SlipChapter({ data, t }) {
  const slip = data.longest_slip;
  return (
    <Chapter
      kicker={t("yir.longest_slip.label")}
      kanji="遅"
      accent="var(--color-laque-bright)"
      i={0}
    >
      <p className="display text-2xl md:text-3xl leading-tight text-[var(--color-ivoire)]">
        {slip.figure_name}
      </p>
      <p className="mt-3 text-[var(--color-ivoire-soft)]">
        {slip.slip_count === 1
          ? t("yir.longest_slip.detail_one", {
              from: slip.original_date ?? "?",
              to: slip.current_date ?? "?",
            })
          : t("yir.longest_slip.detail", {
              slips: slip.slip_count,
              from: slip.original_date ?? "?",
              to: slip.current_date ?? "?",
            })}
      </p>
    </Chapter>
  );
}

// =============================================================================
// Monthly ledger — bar chart retheme'd to A tokens. Keeps the data + the peak
// highlight; gold bars with a jade high-water mark. CSS-only heights so it
// stays GPU-light; the Reveal handles a single fade-in.
// =============================================================================

function Ledger({ data, t }) {
  const counts = new Array(12).fill(0);
  for (const m of data) {
    if (m.month >= 1 && m.month <= 12) counts[m.month - 1] = Number(m.count) || 0;
  }
  const max = Math.max(1, ...counts);
  const total = counts.reduce((a, b) => a + b, 0);
  const peakMonth = counts.indexOf(max) + 1; // 1-12

  return (
    <Chapter kicker={t("yir.timeline.title")} kanji="暦" accent="var(--color-or)" i={0}>
      <div className="flex flex-wrap items-baseline gap-x-8 gap-y-1 mb-6">
        <span className="micro-tight normal-case tracking-[0.18em] text-[var(--color-ivoire-soft)]/70">
          {t("yir.timeline.peak")}{" "}
          {/* The peak month is the year's high-water mark — jade, the calm
              accent, so it pops out of the gold spend figures. */}
          <span className="display text-base" style={{ color: "var(--color-jade)" }}>
            {t(`yir.month.${peakMonth}`)} (<CountUp value={max} />)
          </span>
        </span>
        <span className="micro-tight normal-case tracking-[0.18em] text-[var(--color-ivoire-soft)]/70">
          {t("yir.timeline.total")}{" "}
          <span className="display text-base text-[var(--color-or-pale)]">
            <CountUp value={total} />
          </span>
        </span>
      </div>

      <div className="grid grid-cols-12 gap-1.5 md:gap-2 items-end h-44">
        {counts.map((c, i) => {
          const isPeak = c === max && c > 0;
          const isEmpty = c === 0;
          const heightPct = isEmpty ? 0 : Math.max(4, (c / max) * 100);
          return (
            <div
              key={i}
              className="flex flex-col items-center justify-end h-full min-w-0"
            >
              {c > 0 ? (
                <span
                  className="figural text-[11px] md:text-xs mb-1.5 leading-none"
                  style={{
                    color: isPeak ? "var(--color-jade)" : "var(--color-or-pale)",
                  }}
                >
                  {c}
                </span>
              ) : null}
              <div className="relative w-full flex-1 flex items-end">
                {isEmpty ? (
                  // Empty months read as a faint baseline tick, not a bar.
                  <span
                    aria-hidden
                    className="block w-full h-px"
                    style={{ background: mix("var(--color-or)", 18) }}
                  />
                ) : (
                  <span
                    aria-hidden
                    className="block w-full rounded-t-[2px]"
                    style={{
                      height: `${heightPct}%`,
                      // Peak month glows jade; the rest are a gold gradient.
                      background: isPeak
                        ? `linear-gradient(180deg, var(--color-jade) 0%, ${mix("var(--color-jade)", 50)} 100%)`
                        : `linear-gradient(180deg, ${mix("var(--color-or)", 90)} 0%, ${mix("var(--color-or)", 45)} 100%)`,
                      boxShadow: isPeak
                        ? `0 -8px 22px -10px ${mix("var(--color-jade)", 60)}`
                        : undefined,
                    }}
                  />
                )}
              </div>
              <span
                className="micro-tight mt-2 normal-case tracking-[0.1em] text-[9px] truncate w-full text-center"
                style={
                  isPeak ? { color: "var(--color-jade)" } : undefined
                }
              >
                {t(`yir.month.${i + 1}`)}
              </span>
            </div>
          );
        })}
      </div>
    </Chapter>
  );
}

// =============================================================================
// Bookends — first / last acquisition of the year (jade opens, gold closes).
// =============================================================================

function Bookends({ first, last, t }) {
  const cells = [
    first
      ? {
          eyebrow: t("yir.first_acquisition"),
          name: first.figure_name,
          at: first.at,
          accent: "var(--color-jade)",
        }
      : null,
    last
      ? {
          eyebrow: t("yir.last_acquisition"),
          name: last.figure_name,
          at: last.at,
          accent: "var(--color-or)",
        }
      : null,
  ].filter(Boolean);

  return (
    <Reveal as="section" y={24} className="mt-8">
      <p className="micro inline-flex items-center gap-2 mb-4">
        <span
          aria-hidden
          className="inline-block w-5 h-px"
          style={{ background: mix("var(--color-or)", 80) }}
        />
        {t("yir.bookends.title")}
        <span aria-hidden className="ja text-[var(--color-or-pale)]/70 ml-1">
          標
        </span>
      </p>
      <div className="grid md:grid-cols-2 gap-4">
        {cells.map((b) => (
          <Card
            key={b.eyebrow}
            className="relative p-7 overflow-hidden border-t-2"
            // The accent rides the top edge so the names stay legible ivoire.
          >
            <span
              aria-hidden
              className="absolute top-0 left-0 right-0 h-[2px]"
              style={{ background: b.accent }}
            />
            <p className="micro-tight" style={{ color: b.accent }}>
              {b.eyebrow}
            </p>
            <p className="display text-2xl md:text-3xl mt-3 leading-tight text-[var(--color-ivoire)]">
              {b.name}
            </p>
            <time className="micro-tight mt-4 block normal-case tracking-[0.18em] text-[var(--color-ivoire-soft)]/60">
              {new Date(b.at).toLocaleDateString(appLocale())}
            </time>
          </Card>
        ))}
      </div>
    </Reveal>
  );
}

// =============================================================================
// Empty state — when the year has zero activity. Card with a faint kanji
// watermark + accent eyebrow + title + gold-rule (the A empty-state pattern).
// =============================================================================

function EmptyYear({ t }) {
  return (
    <Reveal as="div" y={20} className="mt-12">
      <Card className="max-w-xl mx-auto p-12 text-center relative overflow-hidden">
        <span
          aria-hidden
          className="ja absolute -top-6 -right-6 text-[12rem] leading-none select-none pointer-events-none"
          style={{ color: mix("var(--color-or)", 9) }}
        >
          空
        </span>
        <p className="micro relative">{t("yir.empty.eyebrow", { default: "Année blanche" })}</p>
        <p className="display text-2xl mt-3 text-[var(--color-ivoire)] relative">
          {t("yir.no_data")}
        </p>
        <div className="gold-rule mx-auto w-20 mt-8" />
      </Card>
    </Reveal>
  );
}

// =============================================================================
// L'année en regard — this year vs the previous one. Hidden when the prior
// year had no activity. Retheme'd to A tokens (gold value, jade up, red down).
// =============================================================================

function YearCompare({ data, t }) {
  const cmp = data.comparison;
  if (!cmp) return null;
  const prevHadData =
    cmp.pieces_acquired > 0 || (cmp.spend_by_currency?.length ?? 0) > 0;
  if (!prevHadData) return null;

  // Spend on the dominant current-year currency, matched in the prior year.
  const nowSpend = data.spend_by_currency?.[0] ?? null;
  const prevSpend = nowSpend
    ? (cmp.spend_by_currency ?? []).find((s) => s.currency === nowSpend.currency)
    : (cmp.spend_by_currency?.[0] ?? null);
  const spendCur = nowSpend?.currency ?? prevSpend?.currency;

  const rows = [
    {
      label: t("yrcmp.pieces"),
      now: data.pieces_acquired,
      prev: cmp.pieces_acquired,
      fmt: (v) => fmtNumber(v),
    },
    spendCur
      ? {
          label: t("yrcmp.spend"),
          now: Number(nowSpend?.total ?? 0),
          prev: Number(prevSpend?.total ?? 0),
          fmt: (v) => fmtMoney(v, spendCur),
        }
      : null,
    {
      label: t("yrcmp.velocity"),
      now: data.pieces_acquired / 12,
      prev: cmp.pieces_acquired / 12,
      fmt: (v) => t("yrcmp.per_month", { n: fmtNumber(v, 1) }),
    },
  ].filter(Boolean);

  return (
    <Chapter kicker={t("yrcmp.title")} kanji="較" accent="var(--color-jade)" i={0}>
      <p className="mb-4">
        <span className="display italic text-2xl text-[var(--color-ivoire)]">
          {data.year}
        </span>{" "}
        <span className="micro-tight">{t("yrcmp.vs", { year: cmp.year })}</span>
      </p>
      <dl className="space-y-3">
        {rows.map((r) => (
          <CmpRow
            key={r.label}
            label={r.label}
            now={r.now}
            prev={r.prev}
            prevYear={cmp.year}
            fmt={r.fmt}
          />
        ))}
      </dl>
    </Chapter>
  );
}

function CmpRow({ label, now, prev, prevYear, fmt }) {
  const delta = prev !== 0 ? Math.round(((now - prev) / prev) * 100) : null;
  const up = now >= prev;
  // Jade for an increase, hanko-red for a decline — the A gain/loss code.
  const deltaColor = up ? "var(--color-jade)" : "var(--color-laque-bright)";
  return (
    <div className="grid grid-cols-[1fr_auto_auto] items-baseline gap-4 py-2 border-b border-dashed border-[var(--color-or)]/15 last:border-b-0">
      <dt className="micro-tight normal-case tracking-[0.18em] text-[var(--color-ivoire-soft)]/80">
        {label}
      </dt>
      <dd className="text-right">
        <span className="display text-xl text-[var(--color-ivoire)] block leading-none">
          {fmt(now)}
        </span>
        <span className="micro-tight block mt-1 text-[var(--color-ivoire-soft)]/50">
          {prevYear} · {fmt(prev)}
        </span>
      </dd>
      <dd
        className="font-mono text-[11px] tracking-wider text-right tabular-nums"
        style={{ color: deltaColor }}
      >
        {delta != null
          ? `${up ? "↑" : "↓"} ${Math.abs(delta)}%`
          : now > 0
            ? "↑"
            : "—"}
      </dd>
    </div>
  );
}

// =============================================================================
// Year navigation — prev / print / next.
// =============================================================================

function YearNavigation({ year, t }) {
  const linkCls =
    "text-[var(--color-ivoire-soft)] hover:text-[var(--color-or)] transition-colors tap-target inline-flex items-center";
  return (
    <nav className="mt-14 pt-6 border-t border-[var(--color-or)]/15 flex items-center justify-between gap-4 print:hidden">
      <Link className={linkCls} to={`/year-in-review/${year - 1}`}>
        ← {t("yir.prev")} ({year - 1})
      </Link>
      <button
        type="button"
        onClick={() => window.print()}
        className="text-[var(--color-or-pale)] hover:text-[var(--color-or)] transition-colors tap-target inline-flex items-center micro-tight normal-case tracking-[0.18em]"
      >
        ⎙ {t("yir.print")}
      </button>
      {year < CURRENT_YEAR ? (
        <Link className={linkCls} to={`/year-in-review/${year + 1}`}>
          {t("yir.next")} ({year + 1}) →
        </Link>
      ) : (
        <span aria-hidden />
      )}
    </nav>
  );
}

// =============================================================================
// Helpers
// =============================================================================

/** Locale-aware number, no trailing zeros unless significant. */
function fmtNumber(n, maxFrac = 2) {
  return Number(n).toLocaleString(appLocale(), {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxFrac,
  });
}

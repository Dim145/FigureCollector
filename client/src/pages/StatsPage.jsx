import { useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import {
  Cell as RechartsCell,
  Pie as RechartsPie,
  PieChart as RechartsPieChart,
} from "recharts";
import { useT } from "../i18n/index.jsx";
import { appLocale } from "../lib/locale.js";
import { useMe } from "../hooks/useMe.js";
import { useMyStats, useInsights } from "../hooks/useStats.js";
import AccentTitle from "../components/AccentTitle.jsx";
import AppShell from "../components/AppShell.jsx";
import PageSkeleton from "../components/Skeleton.jsx";
import ErrorState from "../components/ErrorState.jsx";
import Card from "../components/Card.jsx";
import CountUp from "../components/CountUp.jsx";
import Reveal from "../components/motion/Reveal.jsx";
import Money from "../components/Money.jsx";
import { useDisplayCurrency } from "../components/DisplayCurrencyProvider.jsx";
import { sumInDisplay } from "../lib/money.js";
import { typeHue } from "../lib/typeHue.js";

/**
 * Per-chapter accent palette (néo-vitrine). Each entry is a theme var that
 * flips light/dark — never a raw colour. Drives the chapter-rule glyphs, the
 * localized hero wash and assorted dividers/chips so each section of the
 * ledger reads in its own light while the gold/ink surfaces stay dominant.
 */
const CHAPTER_ACCENT = {
  II: "var(--color-neon-amber)",
  III: "var(--color-jade)",
  IV: "var(--color-or)",
  V: "var(--color-indigo)",
  VI: "var(--color-laque-bright)",
  VII: "var(--color-neon-cyan)",
};

/**
 * Le Grand Livre — the user's annual inventory ledger.
 *
 * Aesthetic moves:
 *   - Hero ledger spread (vertical tag + huge embossed figural)
 *   - Roman-numeral chapter dividers with kanji subtitle
 *   - Brass-tabbed ledger rows for spend per currency (+ sparkline)
 *   - Donut breakdowns (Recharts) for type + condition
 *   - Podium for top-3 manufacturers/series/sculptors (lists below)
 *   - Press-strip year timeline with letterpress numbers above each bar
 *   - "Pièce de la couronne" feature card for the most expensive piece
 *   - Thermometer rule for the price distribution
 *
 * Only the donut breakdowns use a charting library (Recharts) — the rest
 * (sparklines, dials, thermometers, podiums) are hand-rolled because they
 * are bespoke compositions Recharts doesn't ship presets for.
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
        <PageSkeleton blocks={4} />
      </AppShell>
    );
  }

  if (stats.isError) {
    return (
      <AppShell>
        <ErrorState error={stats.error} onRetry={() => stats.refetch()} />
      </AppShell>
    );
  }

  const data = stats.data;
  const empty = !data || data.total_pieces === 0;

  return (
    <AppShell>
      <main className="relative max-w-6xl mx-auto px-6 py-12">
        <HeroWash />
        <div className="relative z-10">
        {empty ? (
          <>
            <TitlePage data={null} t={t} year={new Date().getFullYear()} />
            <Card className="p-10 text-center mt-12">
              <p className="text-[var(--color-ivoire-soft)] italic">
                {t("stats.empty")}
              </p>
            </Card>
          </>
        ) : (
          <>
            {/* I — Title page */}
            <TitlePage data={data} t={t} year={new Date().getFullYear()} />

            {/* II — Dépenses */}
            <ChapterRule roman="II" label={t("stats.ch.spend")} kanji="財" accent={CHAPTER_ACCENT.II} />
            <Reveal
              as="div"
              y={24}
              className="grid lg:grid-cols-[1.4fr_1fr] gap-8 items-start"
            >
              <SpendLedger data={data} t={t} />
              <PreorderDial data={data} t={t} />
            </Reveal>

            {/* III — Répartition */}
            <ChapterRule roman="III" label={t("stats.ch.allocation")} kanji="分" accent={CHAPTER_ACCENT.III} />
            <Reveal as="div" y={24} className="grid lg:grid-cols-2 gap-8">
              <PolarBreakdown
                title={t("stats.by_type.title")}
                kanji="像"
                t={t}
                typed
                rows={data.by_type.map((r) => ({
                  key: r.figure_type,
                  label: t(`type.${r.figure_type}`, { default: r.figure_type }),
                  count: Number(r.count) || 0,
                }))}
              />
              <PolarBreakdown
                title={t("stats.by_condition.title")}
                kanji="態"
                t={t}
                rows={data.by_condition.map((r) => ({
                  key: r.condition,
                  label: t(`condition.${r.condition}`, { default: r.condition }),
                  count: Number(r.count) || 0,
                }))}
              />
            </Reveal>

            {/* IV — Palmarès */}
            <ChapterRule roman="IV" label={t("stats.ch.tops")} kanji="冠" accent={CHAPTER_ACCENT.IV} />
            <Reveal as="div" y={24} className="grid lg:grid-cols-3 gap-8">
              <PodiumColumn
                title={t("stats.top_manufacturers.title")}
                rows={data.top_manufacturers}
                t={t}
              />
              <PodiumColumn
                title={t("stats.top_series.title")}
                rows={data.top_series}
                t={t}
              />
              <PodiumColumn
                title={t("stats.top_sculptors.title")}
                rows={data.top_sculptors}
                t={t}
              />
            </Reveal>

            {/* V — Chronique */}
            <ChapterRule roman="V" label={t("stats.ch.timeline")} kanji="暦" accent={CHAPTER_ACCENT.V} />
            {data.acquisitions_by_year.length === 0 ? (
              <p className="text-center text-[var(--color-ivoire-soft)] py-12 italic">
                {t("stats.timeline.empty")}
              </p>
            ) : (
              <PressStrip data={data.acquisitions_by_year} t={t} />
            )}

            {/* VI — Pièces majeures */}
            <ChapterRule roman="VI" label={t("stats.ch.crown")} kanji="王" accent={CHAPTER_ACCENT.VI} />
            <CrownPieces data={data} t={t} />

            {/* VII — Échelle des prix */}
            {data.price_distribution.length > 0 ? (
              <>
                <ChapterRule roman="VII" label={t("stats.ch.scale")} kanji="幅" accent={CHAPTER_ACCENT.VII} />
                <PriceThermometers data={data} t={t} />
              </>
            ) : null}

            {/* VIII–XI — Lecture approfondie (Lot 5) */}
            <InsightsChapters insights={insights.data} t={t} />

            {/* Colophon — printed-book footer */}
            <Colophon t={t} pieces={data.total_pieces} year={new Date().getFullYear()} />
          </>
        )}
        </div>
      </main>
    </AppShell>
  );
}

// =============================================================================
// Chapter rule — Roman numeral + label + kanji separator
// =============================================================================

function ChapterRule({ roman, label, kanji, accent = "var(--color-or)" }) {
  // The accent only paints the chapter glyphs + tints the trailing rule, so
  // each section opens in its own light. The label stays gold (`--color-or-pale`
  // via CSS) to keep the spread coherent; CSS hover still warms glyphs to gold.
  const tintedLine = `linear-gradient(90deg, transparent, ${colorMix(accent, 55)}, transparent)`;
  return (
    <Reveal
      as="div"
      y={14}
      delay={0.02}
      className="chapter-rule"
      role="separator"
      aria-label={label}
    >
      <span className="chapter-rule-roman" style={{ color: accent }}>
        {roman}.
      </span>
      <span className="chapter-rule-line" aria-hidden />
      <span className="chapter-rule-label">{label}</span>
      <span
        className="chapter-rule-line"
        aria-hidden
        style={{ background: tintedLine }}
      />
      <span className="chapter-rule-kanji" aria-hidden style={{ color: accent }}>
        {kanji}
      </span>
    </Reveal>
  );
}

/** color-mix helper — keep accent translucency in oklab, theme-var safe. */
function colorMix(accentVar, pct) {
  return `color-mix(in oklab, ${accentVar} ${pct}%, transparent)`;
}

// =============================================================================
// VIII–XI — Lecture approfondie (Lot 5 insights). Reads /me/insights; each
// chapter self-hides when its slice is empty, so the ledger never shows a
// blank section. Reuses the in-file ChapterRule + fmtMoney + the ins-* classes
// ported from the validated maquette.
// =============================================================================
function InsightsChapters({ insights, t }) {
  if (!insights) return null;
  const spend = insights.spend_by_year ?? [];
  const completion = insights.series_completion ?? [];
  const wl = insights.wishlist_value ?? [];
  const ph = insights.preorder_health ?? {};
  const hasSpend = spend.length > 0;
  const hasComp = completion.length > 0;
  const hasWl = wl.length > 0 || (insights.wishlist_count ?? 0) > 0;
  const hasPh =
    (ph.deposits?.length ?? 0) > 0 || (ph.open ?? 0) > 0 || (ph.cancellations ?? 0) > 0;
  if (!hasSpend && !hasComp && !hasWl && !hasPh) return null;

  return (
    <>
      {hasSpend ? <SpendByYear spend={spend} t={t} /> : null}

      {hasComp ? (
        <>
          <ChapterRule
            roman="IX"
            label={t("insights.ch.completion")}
            kanji="揃"
            accent="var(--color-jade)"
          />
          <div className="ins-panel">
            {completion.map((s) => (
              <div className="ins-comp-row" key={s.series_id}>
                <span className="ins-comp-name">{s.name}</span>
                <span className="ins-comp-num">
                  <b>{s.owned}</b>/{s.total} · {s.pct}%
                </span>
                <span className="ins-comp-track">
                  <span
                    className="ins-comp-fill"
                    style={{ width: `${Math.min(100, Math.max(0, s.pct))}%` }}
                  />
                </span>
              </div>
            ))}
          </div>
        </>
      ) : null}

      {hasWl ? (
        <>
          <ChapterRule
            roman="X"
            label={t("insights.ch.wishlist")}
            kanji="望"
            accent="var(--color-or)"
          />
          <div className="ins-panel">
            <div className="ins-kpis">
              <div className="ins-kpi">
                <div className="v gold">
                  {wl[0] ? fmtMoney(wl[0].amount, wl[0].currency) : "—"}
                  {wl.length > 1 ? " …" : ""}
                </div>
                <div className="l">{t("insights.wishlist.total")}</div>
                <div className="s">
                  {t("insights.wishlist.count", { n: insights.wishlist_count ?? 0 })}
                </div>
              </div>
            </div>
          </div>
        </>
      ) : null}

      {hasPh ? (
        <>
          <ChapterRule
            roman="XI"
            label={t("insights.ch.preorders")}
            kanji="予"
            accent="var(--color-indigo)"
          />
          <div className="ins-panel">
            <div className="ins-kpis">
              <div className="ins-kpi">
                <div className="v jade">
                  {ph.deposits?.[0]
                    ? fmtMoney(ph.deposits[0].amount, ph.deposits[0].currency)
                    : "—"}
                </div>
                <div className="l">{t("insights.preorders.deposits")}</div>
              </div>
              <div className="ins-kpi">
                <div className="v">
                  {ph.avg_slip_days != null ? t("insights.days", { n: ph.avg_slip_days }) : "—"}
                </div>
                <div className="l">{t("insights.preorders.avg_slip")}</div>
              </div>
              <div className="ins-kpi">
                <div className="v laque">{ph.cancellations ?? 0}</div>
                <div className="l">{t("insights.preorders.cancellations")}</div>
              </div>
            </div>
          </div>
        </>
      ) : null}
    </>
  );
}

/** Spend-by-year bars for the dominant currency (largest total). */
function SpendByYear({ spend, t }) {
  const byCur = {};
  for (const r of spend) byCur[r.currency] = (byCur[r.currency] || 0) + Number(r.total);
  const currency = Object.keys(byCur).sort((a, b) => byCur[b] - byCur[a])[0];
  const rows = spend
    .filter((r) => r.currency === currency)
    .sort((a, b) => a.year - b.year);
  const max = Math.max(...rows.map((r) => Number(r.total)), 1);
  const curYear = new Date().getFullYear();
  return (
    <>
      <ChapterRule
        roman="VIII"
        label={t("insights.ch.spend")}
        kanji="費"
        accent="var(--color-laque-bright)"
      />
      <div className="ins-panel">
        <div className="ins-bars">
          {rows.map((r) => (
            <div className={`ins-bar${r.year === curYear ? " cur" : ""}`} key={r.year}>
              <span className="ins-bar-v">{fmtMoney(r.total, r.currency)}</span>
              <span
                className="ins-barfill"
                style={{ height: `${Math.max(3, (Number(r.total) / max) * 100)}%` }}
              />
              <span className="ins-bar-y">{r.year}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

/**
 * Localized hero colour-wash — a pointer-events-none pair of radial gradients
 * at low alpha pinned to the top of the ledger (behind the title page only).
 * Adds atmosphere/spectacle without competing with the global page aurora.
 * Fully self-contained (inline styles, no shared CSS). Static under
 * prefers-reduced-motion; otherwise a slow GPU-only opacity/scale breathe.
 */
function HeroWash() {
  // Static glow — no breathe. Ambient motion was removed for GPU (alongside the
  // aurora); the colour stays as a fixed, ~0-cost layer. Edges feathered so the
  // gradients fade instead of hard-cutting at the content column (the seam).
  const base = { position: "absolute", inset: 0 };
  const layerA = {
    background: `radial-gradient(60% 70% at 18% 10%, ${colorMix(
      "var(--color-neon-amber)",
      18,
    )}, transparent 70%)`,
  };
  const layerB = {
    background: `radial-gradient(58% 66% at 86% 2%, ${colorMix(
      "var(--color-indigo)",
      16,
    )}, transparent 72%)`,
  };
  const wrap = {
    position: "absolute",
    top: "-3rem",
    left: "-3rem",
    right: "-3rem",
    height: "56vh",
    pointerEvents: "none",
    zIndex: 0,
    WebkitMaskImage:
      "linear-gradient(to right, transparent 0, #000 8%, #000 92%, transparent 100%)",
    maskImage:
      "linear-gradient(to right, transparent 0, #000 8%, #000 92%, transparent 100%)",
  };
  return (
    <div aria-hidden style={wrap}>
      <span style={{ ...base, ...layerA, opacity: 0.85 }} />
      <span style={{ ...base, ...layerB, opacity: 0.85 }} />
    </div>
  );
}

// =============================================================================
// I — Title page
// =============================================================================

function TitlePage({ data, t, year }) {
  const pieces = data?.total_pieces ?? 0;
  return (
    <header className="relative grid grid-cols-[auto_1fr] gap-6 md:gap-12 items-center mb-6 min-h-[36vh]">
      {/* Backdrop kanji 数 (numbers / count) */}
      <span
        aria-hidden
        className="ja absolute right-0 -top-12 text-[26rem] leading-none text-[var(--color-or)]/8 select-none pointer-events-none hidden md:block"
      >
        数
      </span>

      <div className="vertical-tag reveal hidden md:block" style={{ "--i": 0 }}>
        {t("stats.vertical_tag")}
      </div>

      <div className="relative">
        <p className="micro reveal" style={{ "--i": 0 }}>
          {t("stats.subtitle")} · {t("stats.edition", { year })}
        </p>
        <h1
          className="display text-5xl md:text-7xl mt-4 text-[var(--color-ivoire)] leading-[0.9] reveal"
          style={{ "--i": 1 }}
        >
          <AccentTitle text={t("stats.title")} />
        </h1>
        <p
          className="display italic text-xl md:text-2xl text-[var(--color-or-pale)]/80 mt-3 reveal"
          style={{ "--i": 2 }}
        >
          {t("stats.kicker")}
        </p>

        {/* The hero figure — massive embossed total piece count */}
        <div className="mt-8 reveal" style={{ "--i": 3 }}>
          <p className="label-mono mb-2">{t("stats.headline.pieces")}</p>
          <p className="figural-massive">
            <CountUp value={pieces} duration={1400} />
          </p>
        </div>

        {/* Headline satellites — secondary counters in a tight row, each lit
            in its own accent for a vivid spread while values stay legible. */}
        {data ? (
          <div className="mt-10 grid grid-cols-2 md:grid-cols-4 gap-4 reveal" style={{ "--i": 4 }}>
            <Satellite kanji="種" label={t("stats.headline.types")} value={data.distinct_types} accent="var(--color-neon-amber)" />
            <Satellite kanji="社" label={t("stats.headline.manufacturers")} value={data.distinct_manufacturers} accent="var(--color-jade)" />
            <Satellite kanji="作" label={t("stats.headline.series")} value={data.distinct_series} accent="var(--color-indigo)" />
            <Satellite kanji="影" label={t("stats.headline.scans")} value={data.total_scans} accent="var(--color-neon-cyan)" />
          </div>
        ) : null}
      </div>
    </header>
  );
}

function Satellite({ kanji, label, value, accent = "var(--color-or)" }) {
  // Accent only paints the value digits + a soft glow, leaving the left border
  // and kanji to CSS so their existing hover transitions keep firing.
  // The accent lives on the ornamental kanji (decorative variety per satellite);
  // the value stays gold so a number's colour never reads as a status — jade
  // (gain) and cyan (en route) carry meaning elsewhere, and a coloured figure
  // here would muddy that code.
  return (
    <div className="satellite relative border-l border-[var(--color-or)]/30 pl-4 py-1">
      <span
        aria-hidden
        className="sat-kanji ja absolute -top-2 right-2 text-3xl leading-none select-none"
        style={{ color: colorMix(accent, 28) }}
      >
        {kanji}
      </span>
      <p className="label-mono">{label}</p>
      <p
        className="sat-value display text-3xl md:text-4xl mt-1.5 leading-none text-[var(--color-or)]"
        style={{ textShadow: `0 0 22px ${colorMix("var(--color-or)", 25)}` }}
      >
        <CountUp value={Number(value) || 0} />
      </p>
    </div>
  );
}

// =============================================================================
// II — Spend ledger + Preorder dial
// =============================================================================

function SpendLedger({ data, t }) {
  const dc = useDisplayCurrency();
  // We have acquisitions_by_year but not spend-by-year. The sparkline below
  // uses the year acquisition shape (clipped to the last ~8 years) as a soft
  // proxy for "buying intensity" — labelled as such, not as money over time.
  const yearProxy = useMemo(
    () => (data.acquisitions_by_year ?? []).slice(-8),
    [data.acquisitions_by_year],
  );

  // One "all-in" SPEND figure across every currency, in the display currency:
  // the total outlay including shipping (`data.eur.spend`, costs at the rate
  // frozen at purchase). This is the spend ledger, so it keeps shipping — it
  // intentionally differs from La Cote's "payé", which is the figure cost only
  // (the plus-value basis). Falls back to a today's-rate client sum of the
  // bucket grand_totals. Shown only when conversion merges >1 currency or
  // actually converts.
  const buckets = data.spend_by_currency ?? [];
  const conv = (() => {
    if (!(dc.active && dc.ready) || buckets.length === 0) return null;
    const eur = data.eur;
    if (eur) {
      const perEur = dc.display === "EUR" ? 1 : Number(dc.rates?.[dc.display]);
      if (perEur > 0) {
        const converted = buckets.length > 1 || buckets[0].currency !== dc.display;
        return { amount: Number(eur.spend) * perEur, converted };
      }
    }
    return sumInDisplay(dc.rates, dc.display, buckets, "grand_total");
  })();
  const showConv = conv && (buckets.length > 1 || conv.converted);
  return (
    <Card className="relative p-7 overflow-hidden">
      <p className="micro mb-1 inline-flex items-center gap-2">
        <span
          aria-hidden
          className="inline-block w-5 h-px"
          style={{ background: colorMix("var(--color-neon-amber)", 75) }}
        />
        {t("stats.spend.title")}
      </p>
      <p
        className="display italic text-lg mb-5"
        style={{ color: "var(--color-neon-amber)" }}
      >
        {t("stats.spend.kicker")}
      </p>

      {showConv ? (
        <div className="mb-6 pb-5 border-b border-dashed border-[var(--color-or)]/20">
          <p className="ledger-figure" style={{ color: "var(--color-or)" }}>
            <Money amount={conv.amount} currency={dc.display} approx={conv.converted} round />
          </p>
          <p className="ledger-caption mt-1">
            {t("stats.spend.all_currencies")}
            {dc.date ? <span className="font-mono"> · {dc.date}</span> : null}
            {data.eur?.partial ? (
              <span className="text-[var(--color-laque-bright)]">
                {" "}
                · {t("fx.partial")}
              </span>
            ) : null}
          </p>
        </div>
      ) : null}

      {data.spend_by_currency.length === 0 ? (
        <p className="text-[var(--color-ivoire-soft)] italic">
          {t("stats.spend.empty")}
        </p>
      ) : (
        <ul className="-mt-1">
          {data.spend_by_currency.map((s) => (
            <SpendRow
              key={s.currency}
              row={s}
              yearProxy={yearProxy}
              t={t}
            />
          ))}
        </ul>
      )}
    </Card>
  );
}

/** One ledger row: brass tab, big grand-total figure, breakdown captions
 *  (item vs shipping), and a delta-vs-catalog tag when the difference is
 *  large enough to be interesting. */
function SpendRow({ row, yearProxy, t }) {
  const grand = Number(row.grand_total ?? row.total) || 0;
  const item = Number(row.total) || 0;
  const shipping = Number(row.shipping_total) || 0;
  const catalog = Number(row.catalog_total) || 0;
  const hasShipping = shipping > 0.005;
  const hasCatalog = catalog > 0.005;
  // Delta compares the *figure cost only* (`item`) against the catalog
  // MSRP. Mixing in shipping here would always look like overpaying
  // since shipping is non-negative — the user would never see a "saved"
  // chip even when they grabbed a piece on promo.
  const delta = hasCatalog ? item - catalog : 0;
  const deltaPct = hasCatalog && catalog > 0 ? (delta / catalog) * 100 : 0;
  const showDelta = hasCatalog && Math.abs(delta) > 0.01;

  return (
    <li className="ledger-row">
      <span className="brass-tab">{row.currency}</span>
      <div className="min-w-0">
        <p className="ledger-figure">{fmtMoney(grand, row.currency)}</p>
        <p className="ledger-caption mt-1">
          {t("stats.spend.priced_pieces", { count: row.pieces_priced })}
        </p>
        {/* Breakdown — item + shipping + catalog reference */}
        {hasShipping || hasCatalog ? (
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 max-w-xs text-[10.5px]">
            <Bd label={t("stats.spend.row.item")} value={fmtMoney(item, row.currency)} currency={row.currency} />
            {hasShipping ? (
              <Bd label={t("stats.spend.row.shipping")} value={fmtMoney(shipping, row.currency)} currency={row.currency} />
            ) : null}
            {hasCatalog ? (
              <Bd label={t("stats.spend.row.catalog")} value={fmtMoney(catalog, row.currency)} currency={row.currency} dim />
            ) : null}
          </dl>
        ) : null}
        {showDelta ? (
          <p
            className={`mt-2 inline-flex items-center text-[10px] uppercase tracking-[0.22em] border px-2 py-0.5 ${
              delta > 0
                ? "border-[var(--color-laque-bright)]/60 text-[var(--color-laque-bright)]"
                : "border-[var(--color-or)]/60 text-[var(--color-or)]"
            }`}
          >
            {delta > 0
              ? t("stats.spend.over_catalog", {
                  amount: fmtMoney(Math.abs(delta), row.currency),
                  currency: row.currency,
                  pct: deltaPct.toFixed(0),
                })
              : t("stats.spend.under_catalog", {
                  amount: fmtMoney(Math.abs(delta), row.currency),
                  currency: row.currency,
                  pct: Math.abs(deltaPct).toFixed(0),
                })}
          </p>
        ) : null}
      </div>
      <div className="w-28 hidden md:block">
        {yearProxy.length > 1 ? <Sparkline data={yearProxy} /> : null}
      </div>
    </li>
  );
}

/** Tiny breakdown row inside the ledger entry */
function Bd({ label, value, currency, dim = false }) {
  return (
    <>
      <dt
        className={`uppercase tracking-[0.18em] text-[9.5px] ${
          dim ? "text-[var(--color-ivoire-soft)]/55" : "text-[var(--color-or-pale)]/80"
        }`}
      >
        {label}
      </dt>
      <dd
        className={`font-mono ${
          dim
            ? "text-[var(--color-ivoire-soft)]/70"
            : "text-[var(--color-ivoire)]"
        }`}
      >
        {value} <span className="text-[var(--color-or-pale)]/50">{currency}</span>
      </dd>
    </>
  );
}

function Sparkline({ data }) {
  const w = 110;
  const h = 28;
  const max = Math.max(1, ...data.map((d) => Number(d.count) || 0));
  const min = 0;
  const stepX = data.length > 1 ? w / (data.length - 1) : 0;
  const points = data.map((d, i) => {
    const x = i * stepX;
    const y = h - ((Number(d.count) - min) / (max - min || 1)) * h;
    return [x, y];
  });
  const path = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`)
    .join(" ");
  // Close the line down to the baseline so it can be filled as an area —
  // revealed only while the ledger row is hovered.
  const area = `${path} L ${w} ${h} L 0 ${h} Z`;
  const last = points[points.length - 1];
  return (
    <svg className="sparkline" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <path className="sparkline-area" d={area} />
      <path className="sparkline-line" d={path} />
      {points.map((p, i) => (
        <circle key={i} className="spark-pt" cx={p[0]} cy={p[1]} r="1.7" />
      ))}
      {last ? <circle className="spark-end" cx={last[0]} cy={last[1]} r="2" /> : null}
    </svg>
  );
}

function PreorderDial({ data, t }) {
  const p = data.preorders;
  const total = (p.placed || 0) + (p.received || 0) + (p.cancelled || 0);
  // four-row inventory table style — same brass tab, terse caption.
  const rows = [
    { kanji: "予", label: t("stats.preorders.placed"), value: p.placed, tone: "ivory" },
    { kanji: "途", label: t("stats.preorders.open"), value: p.open, tone: "jade" },
    { kanji: "受", label: t("stats.preorders.received"), value: p.received, tone: "gold-pale" },
    { kanji: "棄", label: t("stats.preorders.cancelled"), value: p.cancelled, tone: "dim" },
  ];
  return (
    <Card className="relative p-7 overflow-hidden">
      <p className="micro mb-1 inline-flex items-center gap-2">
        <span
          aria-hidden
          className="inline-block w-5 h-px"
          style={{ background: colorMix("var(--color-jade)", 75) }}
        />
        {t("stats.preorders.title")}
      </p>
      <p
        className="display italic text-lg mb-5"
        style={{ color: "var(--color-jade)" }}
      >
        {t("stats.preorders.kicker")}
      </p>

      <ul className="space-y-3">
        {rows.map((r) => (
          <li
            key={r.label}
            className="preorder-row flex items-baseline gap-4 py-2 border-b border-dashed border-[var(--color-or)]/15 last:border-b-0"
          >
            <span
              aria-hidden
              className="pre-kanji ja text-2xl leading-none text-[var(--color-or)]/40 w-8 shrink-0"
            >
              {r.kanji}
            </span>
            <span className="pre-count display text-3xl leading-none tracking-tight">
              <span className={toneColor(r.tone)}>
                <CountUp value={Number(r.value) || 0} />
              </span>
            </span>
            <span className="micro flex-1 text-right truncate">{r.label}</span>
          </li>
        ))}
      </ul>
      {total > 0 ? (
        <p className="micro-tight mt-5 text-center opacity-70">
          {t("stats.preorders.cumul", { n: total })}
        </p>
      ) : null}
    </Card>
  );
}

function toneColor(tone) {
  switch (tone) {
    case "gold": return "text-[var(--color-or)]";
    case "gold-pale": return "text-[var(--color-or-pale)]";
    case "jade": return "text-[var(--color-jade)]";
    case "dim": return "text-[var(--color-ivoire-soft)]/60";
    case "ivory":
    default: return "text-[var(--color-ivoire)]";
  }
}

// =============================================================================
// III — Polar breakdown (donut + radial bars)
// =============================================================================

function PolarBreakdown({ title, kanji, rows, t, typed = false }) {
  const total = rows.reduce((s, r) => s + r.count, 0);
  const top = [...rows].sort((a, b) => b.count - a.count)[0];
  // When the breakdown maps to figure types, the dominant type tints the
  // section header so the eye links chart → category. Falls back to gold.
  const headerHue = typed && top ? typeHue(top.key) : "var(--color-or-pale)";
  // Shared active segment — drives both the donut (which wedge pops + the
  // others dim) and the legend (matching row lights up). Bidirectional:
  // set from either side so hovering a name isolates its wedge and
  // hovering a wedge isolates its name.
  const [activeIndex, setActiveIndex] = useState(null);

  if (rows.length === 0) {
    return (
      <Card className="p-7">
        <p className="micro mb-4">{title}</p>
        <p className="text-[var(--color-ivoire-soft)] italic">—</p>
      </Card>
    );
  }
  return (
    <Card className="relative p-7">
      <p className="micro mb-5 inline-flex items-center gap-2">
        <span
          aria-hidden
          className="inline-block w-5 h-px"
          style={{ background: colorMix(headerHue, 75) }}
        />
        <span style={typed ? { color: headerHue } : undefined}>{title}</span>
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-[170px_1fr] gap-6 sm:gap-7 items-center">
        <PolarChart
          rows={rows}
          kanji={kanji}
          total={total}
          activeIndex={activeIndex}
          setActiveIndex={setActiveIndex}
        />
        <ol className="space-y-2.5">
          {rows.map((r, i) => {
            const share = total > 0 ? (r.count / total) * 100 : 0;
            return (
              <li
                key={r.key}
                className="legend-row flex items-baseline gap-3 text-sm"
                data-active={activeIndex === i}
                data-dim={activeIndex != null && activeIndex !== i}
                onMouseEnter={() => setActiveIndex(i)}
                onMouseLeave={() => setActiveIndex(null)}
                onFocus={() => setActiveIndex(i)}
                onBlur={() => setActiveIndex(null)}
                tabIndex={0}
              >
                <span
                  className="legend-swatch block w-2 h-2 shrink-0 self-start mt-1.5"
                  style={{ background: segmentColor(i, rows.length) }}
                />
                <span className="legend-label flex-1 truncate">{r.label}</span>
                {typed ? (
                  <span
                    aria-hidden
                    className="block w-1.5 h-1.5 rounded-full shrink-0 self-center"
                    style={{
                      background: typeHue(r.key),
                      boxShadow: `0 0 6px ${colorMix(typeHue(r.key), 60)}`,
                    }}
                  />
                ) : null}
                <span className="legend-count font-mono text-[11px] tracking-wider">
                  {r.count}
                </span>
                <span className="legend-share font-mono text-[10px] w-10 text-right">
                  {share.toFixed(0)}%
                </span>
              </li>
            );
          })}
        </ol>
      </div>
      {top ? (
        <p className="absolute top-7 right-7 text-right">
          <span className="micro-tight block">{rows.length > 1 ? t("stats.dominant") : t("stats.unique")}</span>
          <span
            className="display italic text-base"
            style={{ color: typed ? headerHue : "var(--color-or-pale)" }}
          >
            {top.label}
          </span>
        </p>
      ) : null}
      {rows.length > 1 ? (
        <p
          className="legend-hint micro-tight mt-5 text-center"
          data-quiet={activeIndex != null}
        >
          {t("stats.interact.hint")}
        </p>
      ) : null}
    </Card>
  );
}

/** Donut breakdown — Recharts PieChart in donut configuration.
 *
 * Hand-rolling the SVG (wedges + arcs + even-odd full-circle special case)
 * was fragile: the 1-category case lost a chunk, the 2-category case
 * looked like two separate crescents. Recharts handles all the edge
 * cases (single segment closing to a full ring, equal halves, paddings)
 * correctly out of the box, costs ~70 KB gzipped, tree-shakes to just
 * PieChart + Pie + Cell.
 *
 * The kanji is positioned in the centre via the PieChart's
 * `label`-on-the-pie centerpoint trick: an absolutely-positioned span
 * inside the wrapper sits exactly at the donut's inner-ring centre.
 */
function PolarChart({ rows, kanji, total, activeIndex, setActiveIndex }) {
  const size = 170;
  const data = rows.map((r, i) => ({
    name: r.label,
    value: r.count,
    fill: segmentColor(i, rows.length),
  }));
  const active = activeIndex != null ? data[activeIndex] : null;
  const pct = active && total > 0 ? Math.round((active.value / total) * 100) : 0;

  return (
    <div
      className="donut-wrap relative"
      style={{ width: size, height: size }}
      data-active={activeIndex != null}
    >
      <RechartsPieChart width={size} height={size}>
        <RechartsPie
          data={data}
          cx="50%"
          cy="50%"
          innerRadius={26}
          outerRadius={size / 2 - 8}
          // Tiny 1° padding between wedges. Recharts also renders a clean
          // full ring when there's only one segment — no special case needed.
          paddingAngle={data.length > 1 ? 1 : 0}
          dataKey="value"
          // Hover state is fully controlled by us (so it links with the
          // legend) — Recharts' own entry animation would re-fire on every
          // re-colour, so we keep it off and animate the wrapper via CSS.
          isAnimationActive={false}
          stroke="transparent"
          onMouseEnter={(_, idx) => setActiveIndex(idx)}
          onMouseLeave={() => setActiveIndex(null)}
        >
          {data.map((entry, i) => {
            const isActive = activeIndex === i;
            const dim = activeIndex != null && !isActive;
            return (
              <RechartsCell
                key={i}
                fill={entry.fill}
                fillOpacity={dim ? 0.28 : 1}
                stroke={isActive ? "var(--color-or-pale)" : "transparent"}
                strokeWidth={isActive ? 1.5 : 0}
              />
            );
          })}
        </RechartsPie>
      </RechartsPieChart>
      {/* Centre — kanji at rest, morphing to the active wedge's share on
          hover. Both layers occupy the same grid cell and cross-fade. */}
      <span
        aria-hidden
        className="donut-center"
        data-active={activeIndex != null}
      >
        <span className="ja donut-kanji">{kanji}</span>
        <span className="donut-pct display">{pct}%</span>
      </span>
    </div>
  );
}

/** Tonal staircase (bright champagne → deep bronze) at FULL opacity, kept
 *  inside the Vitrine gold/bronze family. The old version faded a single
 *  hue's opacity toward the noir background, so the lower tiers muddied into
 *  the bg and into each other — wedges past the third were near-impossible
 *  to tell apart. Stepping lightness (and easing the hue warmer as it
 *  darkens) keeps every segment legible on the dark ground. */
function segmentColor(i, _n) {
  // Dark theme: bright champagne → deep bronze (reads on the near-black card).
  // Light theme: a deeper staircase so the wedges keep contrast against the
  // near-white card surface (the bright tiers would otherwise wash out).
  const dark = [
    "oklch(0.86 0.09 84)",
    "oklch(0.75 0.115 80)",
    "oklch(0.65 0.12 74)",
    "oklch(0.56 0.11 66)",
    "oklch(0.49 0.10 58)",
    "oklch(0.64 0.055 92)",
    "oklch(0.55 0.05 88)",
    "oklch(0.47 0.05 80)",
    "oklch(0.41 0.045 70)",
    "oklch(0.36 0.04 62)",
  ];
  const light = [
    "oklch(0.64 0.13 72)",
    "oklch(0.56 0.13 66)",
    "oklch(0.49 0.12 58)",
    "oklch(0.43 0.11 50)",
    "oklch(0.38 0.10 44)",
    "oklch(0.58 0.06 86)",
    "oklch(0.50 0.055 80)",
    "oklch(0.44 0.05 72)",
    "oklch(0.39 0.045 64)",
    "oklch(0.34 0.04 56)",
  ];
  const isLight =
    typeof document !== "undefined" &&
    document.documentElement.dataset.theme === "light";
  const tiers = isLight ? light : dark;
  return tiers[i] ?? (isLight ? "oklch(0.30 0.03 56)" : "oklch(0.33 0.03 60)");
}

// =============================================================================
// IV — Podium of tops
// =============================================================================

function PodiumColumn({ title, rows, t }) {
  if (!rows || rows.length === 0) {
    return (
      <Card className="p-7">
        <p className="micro mb-4">{title}</p>
        <p className="text-[var(--color-ivoire-soft)] italic">
          {t("stats.top.empty")}
        </p>
      </Card>
    );
  }
  const podium = rows.slice(0, 3);
  const rest = rows.slice(3, 10);
  return (
    <div>
      <p className="micro mb-4 inline-flex items-center gap-2">
        <span
          aria-hidden
          className="inline-block w-5 h-px"
          style={{ background: colorMix("var(--color-or)", 80) }}
        />
        {title}
      </p>
      <div className="grid grid-cols-3 gap-1.5 items-end">
        {/* Reorder for visual hierarchy: 2 · 1 · 3 (silver in the middle of
         *  the screen looks weird; we keep 1·2·3 left-to-right so it reads
         *  like a list, with #1 visually elevated through extra padding) */}
        {podium.map((r, i) => (
          <div
            key={`${r.name}-${i}`}
            className={`podium-tier ledger-tip ${i === 0 ? "podium-tier--gold" : ""}`}
            style={{ "--lift": i === 0 ? "-8px" : "0px" }}
            data-tip={`${r.name} · ${r.count} fig.`}
          >
            <span className="podium-rank">{String(i + 1).padStart(2, "0")}</span>
            <span className="podium-name">{truncate(r.name, 36)}</span>
            <span className="podium-count">
              {r.count} {r.count === 1 ? "fig." : "fig."}
            </span>
          </div>
        ))}
      </div>

      {rest.length > 0 ? (
        <ol className="mt-5 space-y-1.5">
          {rest.map((r, idx) => (
            <li
              key={`${r.name}-${idx}`}
              className="podium-rest flex items-baseline gap-3 text-[13px]"
            >
              <span className="podium-rest-rank font-mono text-[10px] w-5 shrink-0">
                {String(idx + 4).padStart(2, "0")}
              </span>
              <span className="podium-rest-name flex-1 truncate">{r.name}</span>
              <span className="font-mono text-[10.5px] text-[var(--color-or-pale)] shrink-0">
                {r.count}
              </span>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

function truncate(s, max) {
  if (!s || s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

// =============================================================================
// V — Press strip (year timeline)
// =============================================================================

function PressStrip({ data, t }) {
  const max = Math.max(1, ...data.map((d) => Number(d.count) || 0));
  // Hovering one year isolates it — siblings dim, the count swells, and the
  // caption line below swaps to a live readout for the focused year.
  const [hoveredYear, setHoveredYear] = useState(null);
  const hot = data.find((d) => d.year === hoveredYear) || null;
  return (
    <Reveal as="div" y={22} className="press-strip">
      <div
        className="press-grid"
        data-active={hoveredYear != null}
        style={{
          gridTemplateColumns: `repeat(${data.length}, minmax(0, 1fr))`,
        }}
      >
        {data.map((d, i) => {
          const h = ((Number(d.count) || 0) / max) * 100;
          return (
            <div
              key={d.year}
              className="press-col"
              data-hot={d.year === hoveredYear}
              tabIndex={0}
              aria-label={t("stats.timeline.readout", {
                count: d.count,
                year: d.year,
              })}
              onMouseEnter={() => setHoveredYear(d.year)}
              onMouseLeave={() => setHoveredYear(null)}
              onFocus={() => setHoveredYear(d.year)}
              onBlur={() => setHoveredYear(null)}
            >
              <span className="press-count">
                <span className="press-count-n">{d.count}</span>
              </span>
              <div
                className="press-bar"
                style={{
                  height: `${h}%`,
                  animationDelay: `${i * 60}ms`,
                  // Indigo base warming to gold at the cap — keeps the timeline
                  // vivid while staying on-brand. Overrides only `background`,
                  // so the scaleY entrance + hover filter/shadow stay intact.
                  background: `linear-gradient(to top, ${colorMix(
                    "var(--color-indigo)",
                    80,
                  )}, ${colorMix("var(--color-indigo-bright)", 60)} 55%, ${colorMix(
                    "var(--color-or-pale)",
                    75,
                  )} 100%)`,
                }}
              />
              <span className="press-year">{d.year}</span>
            </div>
          );
        })}
      </div>
      <p className="press-readout" data-active={hot != null} aria-live="polite">
        {hot
          ? t("stats.timeline.readout", { count: hot.count, year: hot.year })
          : t("stats.timeline.caption")}
      </p>
    </Reveal>
  );
}

// =============================================================================
// VI — Crown piece (most expensive)
// =============================================================================

function CrownPieces({ data, t }) {
  if (data.most_expensive.length === 0) {
    return (
      <p className="text-center text-[var(--color-ivoire-soft)] italic py-8">
        {t("stats.most_expensive.empty")}
      </p>
    );
  }
  return (
    <Reveal as="div" y={24} className="grid lg:grid-cols-2 gap-6">
      {data.most_expensive.map((m, i) => (
        <article key={`${m.currency}-${m.figure_id}`} className="crown-card">
          {/* Thin laque accent strip along the top edge — the crown's ribbon. */}
          <span
            aria-hidden
            className="absolute top-0 left-0 right-0 h-px"
            style={{
              background: `linear-gradient(90deg, transparent, ${colorMix(
                "var(--color-laque-bright)",
                70,
              )} 30%, ${colorMix("var(--color-or)", 60)} 70%, transparent)`,
            }}
          />
          <p className="crown-eyebrow">
            {t("stats.most_expensive.eyebrow")} · {m.currency}
          </p>
          <h3 className="display text-3xl md:text-4xl text-[var(--color-ivoire)] mt-3 leading-tight">
            <Link
              to={`/figures/${m.figure_id}`}
              className="hover:text-[var(--color-or-pale)] transition-colors"
            >
              {m.figure_name}
            </Link>
          </h3>
          {/* Accent rule — laque→gold gradient instead of the plain gold rule. */}
          <div
            className="w-12 h-px mt-5 mb-4 opacity-80"
            style={{
              background: `linear-gradient(90deg, ${colorMix(
                "var(--color-laque-bright)",
                90,
              )}, ${colorMix("var(--color-or)", 80)})`,
            }}
          />
          <p className="display font-light text-4xl md:text-5xl text-[var(--color-or)]">
            {fmtMoney(m.price, m.currency)}
            <span className="font-mono text-base text-[var(--color-or-pale)]/70 ml-3 align-baseline">
              {m.currency}
            </span>
          </p>
          {m.purchase_date ? (
            <p className="micro-tight mt-5">
              {t("stats.most_expensive.acquired")} ·{" "}
              <time dateTime={m.purchase_date}>
                {new Date(m.purchase_date).toLocaleDateString(appLocale(), {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                })}
              </time>
            </p>
          ) : null}
          <span
            aria-hidden
            className="absolute bottom-4 right-5 font-mono text-[9px] tracking-[0.3em] uppercase"
            style={{ color: colorMix("var(--color-laque-bright)", 55) }}
          >
            n<sup>o</sup> {i + 1}
          </span>
        </article>
      ))}
    </Reveal>
  );
}

// =============================================================================
// VII — Thermomètre (price distribution)
// =============================================================================

function PriceThermometers({ data, t }) {
  return (
    <Reveal as="div" y={24} className="space-y-12">
      {data.price_distribution.map((p) => (
        <PriceThermometer key={p.currency} dist={p} t={t} />
      ))}
    </Reveal>
  );
}

function PriceThermometer({ dist, t }) {
  const min = Number(dist.min) || 0;
  const max = Number(dist.max) || 1;
  const med = Number(dist.median) || 0;
  const avg = Number(dist.avg) || 0;
  const span = max - min || 1;
  const clampPos = (v) => Math.max(0, Math.min(100, ((v - min) / span) * 100));

  // Hovering a marker on the track and hovering its figure in the grid both
  // light the same `key` — so the reader can learn which mark is the median
  // vs the mean, and where each sits on the min→max range.
  const [hoveredKey, setHoveredKey] = useState(null);
  const enter = (k) => () => setHoveredKey(k);
  const leave = () => setHoveredKey(null);

  // The visual scale carries NO text — only the min/max end-dots plus a
  // médiane tick and a moyenne diamond. Whatever their values, two shapes
  // can touch without ever turning into unreadable overlapping text. The
  // numbers live in the collision-proof 4-column grid below.
  const stats = [
    { key: "min", value: min, label: t("stats.price_dist.min"), glyph: null },
    { key: "median", value: med, label: t("stats.price_dist.median"), glyph: "│" },
    { key: "avg", value: avg, label: t("stats.price_dist.avg"), glyph: "◆" },
    { key: "max", value: max, label: t("stats.price_dist.max"), glyph: null },
  ];

  return (
    <Card className="p-7">
      <div className="flex items-baseline justify-between mb-5">
        <p className="micro inline-flex items-center gap-2">
          <span
            aria-hidden
            className="inline-block w-5 h-px"
            style={{ background: colorMix("var(--color-neon-cyan)", 75) }}
          />
          {t("stats.price_dist.title")}
        </p>
        <span className="brass-tab">{dist.currency}</span>
      </div>

      <div className="price-scale" aria-hidden>
        <span
          className="price-scale-track"
          style={{
            background: `linear-gradient(90deg, ${colorMix(
              "var(--color-neon-cyan)",
              30,
            )}, ${colorMix("var(--color-neon-cyan)", 75)}, ${colorMix(
              "var(--color-neon-cyan)",
              30,
            )})`,
          }}
        />
        <span
          className="price-scale-end ledger-tip"
          data-hot={hoveredKey === "min"}
          data-tip={`${t("stats.price_dist.min")} · ${fmtMoney(min, dist.currency)}`}
          style={{ left: "0%" }}
          onMouseEnter={enter("min")}
          onMouseLeave={leave}
        />
        <span
          className="price-scale-end ledger-tip"
          data-hot={hoveredKey === "max"}
          data-tip={`${t("stats.price_dist.max")} · ${fmtMoney(max, dist.currency)}`}
          style={{ left: "100%" }}
          onMouseEnter={enter("max")}
          onMouseLeave={leave}
        />
        <span
          className="price-scale-median ledger-tip"
          data-hot={hoveredKey === "median"}
          data-tip={`${t("stats.price_dist.median")} · ${fmtMoney(med, dist.currency)}`}
          style={{ left: `${clampPos(med)}%`, background: "var(--color-neon-cyan)" }}
          onMouseEnter={enter("median")}
          onMouseLeave={leave}
        />
        <span
          className="price-scale-mean ledger-tip"
          data-hot={hoveredKey === "avg"}
          data-tip={`${t("stats.price_dist.avg")} · ${fmtMoney(avg, dist.currency)}`}
          style={{ left: `${clampPos(avg)}%` }}
          onMouseEnter={enter("avg")}
          onMouseLeave={leave}
        />
      </div>

      <dl className="price-scale-grid">
        {stats.map((s) => (
          <div
            key={s.key}
            className="price-scale-stat"
            data-hot={hoveredKey === s.key}
            data-dim={hoveredKey != null && hoveredKey !== s.key}
            onMouseEnter={enter(s.key)}
            onMouseLeave={leave}
          >
            <dt>
              {s.glyph ? (
                <span aria-hidden className="price-scale-stat-glyph">
                  {s.glyph}
                </span>
              ) : null}
              {s.label}
            </dt>
            <dd>{fmtMoney(s.value, dist.currency)}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

// =============================================================================
// Colophon — printed-book footer
// =============================================================================

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

// =============================================================================
// Helpers
// =============================================================================

const ZERO_DECIMALS = new Set(["JPY", "KRW", "VND", "IDR"]);

function fmtMoney(raw, currency) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return "—";
  const maxFrac = ZERO_DECIMALS.has(currency) ? 0 : 2;
  return n.toLocaleString(appLocale(), {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxFrac,
  });
}

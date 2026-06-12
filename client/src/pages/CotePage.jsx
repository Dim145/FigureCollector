import { useEffect, useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useT } from "../i18n/index.jsx";
import { useMe } from "../hooks/useMe.js";
import { useOwnedItems, useSetOwnedValue } from "../hooks/useCollection.js";
import { useMyPriceHistory, useMyStats } from "../hooks/useStats.js";
import AccentTitle from "../components/AccentTitle.jsx";
import AppShell from "../components/AppShell.jsx";
import Money from "../components/Money.jsx";
import { useDisplayCurrency } from "../components/DisplayCurrencyProvider.jsx";
import { SectionSkeleton } from "../components/Skeleton.jsx";
import Reveal from "../components/motion/Reveal.jsx";
import {
  PriceLedger,
  StepChart,
  StepSparkline,
  seriesDelta,
  toSeries,
} from "../components/PriceHistory.jsx";
import { typeHue, typeKanji } from "../lib/typeHue.js";
import { fmtMoney, effectiveValue, figurePaid } from "../lib/money.js";

// Range chips for the evolution chart (days of look-back; "all" = full history).
const RANGES = ["3m", "6m", "1y", "all"];
const RANGE_DAYS = { "3m": 91, "6m": 183, "1y": 365 };

/** `/cote#figure-<uuid>` (the figure-page dialog's deep link) → figure id. */
function hashFigureId() {
  const m = window.location.hash.match(/^#figure-([0-9a-f-]{36})$/i);
  return m ? m[1] : null;
}

/**
 * « La Cote » — collection-value dashboard.
 *
 * Hero: estimated total value (per dominant currency) + paid + latent
 * plus-value. Below: every owned piece ranked by value, each with an inline
 * editor for the manual valuation (the "cote"), falling back to the catalog
 * MSRP when none is set. Amounts convert to the user's display currency at
 * today's rate (DisplayCurrencyProvider); the per-currency originals stay
 * available as the hero footnote and on hover.
 */
export default function CotePage() {
  const t = useT();
  const me = useMe();
  const owned = useOwnedItems();
  const stats = useMyStats();
  const setValue = useSetOwnedValue();

  const locale = document.documentElement.lang || undefined;
  const prefCurrency = me.data?.user?.preferred_currency || "EUR";

  // Memoized so their identity is stable across renders — otherwise the `?? []`
  // makes a fresh array each render, which would defeat the conversion memo
  // below (and trips exhaustive-deps).
  const valueBuckets = useMemo(
    () => stats.data?.value_by_currency ?? [],
    [stats.data?.value_by_currency],
  );
  const spendBuckets = useMemo(
    () => stats.data?.spend_by_currency ?? [],
    [stats.data?.spend_by_currency],
  );
  const primary = valueBuckets[0] ?? null;
  const primaryPaid = primary
    ? spendBuckets.find((s) => s.currency === primary.currency) ?? null
    : null;
  // Plus-value compares value against the figure PRICE only (bucket `total`),
  // not `grand_total` (price + shipping) — shipping is a sunk cost the resale
  // never recovers, so folding it in would show a perpetual loss.
  const plusValue =
    primary && primaryPaid ? Number(primary.estimated_total) - Number(primaryPaid.total) : null;
  const plusPct =
    plusValue != null && primaryPaid && Number(primaryPaid.total) > 0
      ? (plusValue / Number(primaryPaid.total)) * 100
      : null;

  // Display-currency conversion (on by default — see DisplayCurrencyProvider).
  // Phase 2: prefer the server's EUR-normalised totals (`stats.eur`) — cost at
  // the rate FROZEN at purchase, value at today's rate — then convert that one
  // EUR figure into the display currency. This keeps the latent plus-value free
  // of FX drift on the cost side. Falls back to a client-side per-currency sum
  // at today's rate if the server couldn't compute them (rate table down). The
  // per-currency originals stay the footnote; off / no preferred currency → the
  // dominant per-currency bucket, exactly as the rows read.
  const dc = useDisplayCurrency();
  const fxActive = dc.active && dc.ready;
  const serverEur = stats.data?.eur ?? null;
  // Done in a memo so the per-bucket reduce + EUR math stay OUT of render scope:
  // there they sat beside `primary = valueBuckets[0]` (the `evo` memo's dep) and
  // the React Compiler refused to preserve evo's memoization.
  const { convValue, convPaid } = useMemo(() => {
    if (!fxActive) return { convValue: null, convPaid: null };
    const eurRate = (cur) => {
      const c = (cur || "").toUpperCase();
      if (c === "EUR") return 1;
      const r = dc.rates?.[c];
      return r != null && Number(r) > 0 ? Number(r) : null;
    };
    // EUR → display: units of the display currency per 1 EUR.
    const displayPerEur = eurRate(dc.display);
    if (serverEur && displayPerEur != null) {
      return {
        convValue: Number(serverEur.value) * displayPerEur,
        convPaid: Number(serverEur.cost) * displayPerEur,
      };
    }
    const sum = (buckets, field) =>
      buckets.reduce((s, b) => {
        const rf = eurRate(b.currency);
        const rt = eurRate(dc.display);
        if (rf == null || rt == null) return s;
        return s + (Number(b[field]) / rf) * rt;
      }, 0);
    return {
      convValue: sum(valueBuckets, "estimated_total"),
      convPaid: sum(spendBuckets, "total"),
    };
  }, [fxActive, serverEur, dc.rates, dc.display, valueBuckets, spendBuckets]);
  const convPlus =
    convValue != null && convPaid != null ? convValue - convPaid : null;
  const convPlusPct =
    convPlus != null && convPaid > 0 ? (convPlus / convPaid) * 100 : null;

  // What the hero/KPIs show — converted total (conversion on) or the dominant
  // per-currency bucket (off / no preferred currency).
  const showFx = fxActive && valueBuckets.length > 0;
  const dispCur = showFx ? dc.display : primary?.currency;
  const dispValue = showFx
    ? convValue
    : primary
      ? Number(primary.estimated_total)
      : null;
  const dispPaid = showFx
    ? convPaid
    : primaryPaid
      ? Number(primaryPaid.total)
      : null;
  const dispPlus = showFx ? convPlus : plusValue;
  const dispPlusPct = showFx ? convPlusPct : plusPct;

  const valuedCount = valueBuckets.reduce((a, b) => a + b.pieces_valued, 0);
  const autoCount = valueBuckets.reduce((a, b) => a + (b.pieces_auto ?? 0), 0);
  const msrpCount = valueBuckets.reduce((a, b) => a + b.pieces_msrp, 0);
  const totalCount = owned.data?.length ?? stats.data?.total_pieces ?? 0;

  // Every owned piece with a resolvable value, ranked high → low. Doubles as
  // the bulk-valuation surface (each row is inline-editable).
  const ranked = useMemo(() => {
    return (owned.data ?? [])
      .map((o) => ({ o, ev: effectiveValue(o), paid: figurePaid(o) }))
      .filter((r) => r.ev)
      .sort((a, b) => b.ev.amount - a.ev.amount);
  }, [owned.data]);

  const [editId, setEditId] = useState(null);
  const [draft, setDraft] = useState("");

  // ----- Market-price history (the price cron's relevés) --------------------
  const history = useMyPriceHistory();
  const [range, setRange] = useState("all");
  // Expanded registre, keyed by FIGURE id — seeded from the deep-link hash so
  // arriving from the figure-page dialog lands with the row already open.
  const [openHist, setOpenHist] = useState(() => hashFigureId());

  // figure_id → sorted chart points; feeds sparklines, registres and the curve.
  const historyByFigure = useMemo(() => {
    const byFig = new Map();
    for (const row of history.data ?? []) {
      const arr = byFig.get(row.figure_id);
      if (arr) arr.push(row);
      else byFig.set(row.figure_id, [row]);
    }
    const out = new Map();
    for (const [fid, rows] of byFig) out.set(fid, toSeries(rows));
    return out;
  }, [history.data]);

  // Collection evolution — "what the hero figure would have read at date T",
  // reconstructed per the cote chain (manual > auto > MSRP): manual values and
  // MSRP aren't historized so they contribute constants; provider prices
  // contribute their step series (MSRP fallback before a piece's 1st relevé).
  // Dominant currency only, mirroring the hero.
  const evo = useMemo(() => {
    const cur = primary?.currency;
    const items = owned.data ?? [];
    if (!cur || !items.length || historyByFigure.size === 0) return null;
    const eq = (c) => (c || "").toUpperCase() === cur.toUpperCase();
    let constant = 0;
    const stepped = [];
    for (const o of items) {
      if (o.value_amount != null) {
        if (eq(o.value_currency || o.price_currency)) constant += Number(o.value_amount) || 0;
        continue;
      }
      const series = (historyByFigure.get(o.figure_id) ?? []).filter((p) => eq(p.currency));
      const msrp =
        o.msrp_amount != null && eq(o.msrp_currency) ? Number(o.msrp_amount) : null;
      if (series.length) stepped.push({ series, msrp });
      else if (msrp != null) constant += msrp;
    }
    if (!stepped.length) return null;
    // Ranges are anchored on the LAST relevé (no clock during render): the
    // chart's right edge is the latest observation, which the step visually
    // extends as "holds today".
    let endT = 0;
    for (const s of stepped) for (const p of s.series) if (p.t > endT) endT = p.t;
    if (!endT) return null;
    const cutoff = range === "all" ? 0 : endT - RANGE_DAYS[range] * 86_400_000;
    const changeTs = new Set();
    for (const s of stepped) for (const p of s.series) if (p.t >= cutoff) changeTs.add(p.t);
    const sorted = [...changeTs].sort((a, b) => a - b);
    if (!sorted.length) return null;
    const start = cutoff > 0 ? cutoff : sorted[0];
    const ts = [...new Set([start, ...sorted.filter((x) => x > start)])].sort((a, b) => a - b);
    if (ts.length < 2) return null;
    const valAt = (T) => {
      let total = constant;
      for (const s of stepped) {
        let v = null;
        for (const p of s.series) {
          if (p.t <= T) v = p.v;
          else break;
        }
        if (v == null) v = s.msrp;
        if (v != null) total += v;
      }
      return total;
    };
    return ts.map((T) => ({ t: T, v: valAt(T), currency: cur }));
  }, [owned.data, historyByFigure, primary?.currency, range]);
  const evoDelta = seriesDelta(evo);

  // Deep link from the figure-page dialog: once the rows exist in the DOM,
  // bring the (already-expanded) hash-targeted row into view.
  useEffect(() => {
    const fid = hashFigureId();
    if (!fid || !owned.data?.length) return;
    document.getElementById(`figure-${fid}`)?.scrollIntoView({ block: "center" });
  }, [owned.data]);

  const startEdit = (o) => {
    setEditId(o.id);
    setDraft(o.value_amount != null ? String(o.value_amount) : "");
  };
  const saveEdit = (o) => {
    const raw = draft.trim().replace(",", ".");
    const amount = raw === "" ? null : Number(raw);
    if (amount != null && !Number.isFinite(amount)) return;
    const currency = o.value_currency || o.price_currency || prefCurrency;
    setValue.mutate(
      { id: o.id, amount, currency: amount == null ? null : currency },
      { onSuccess: () => setEditId(null) },
    );
  };
  const resetMsrp = (o) =>
    setValue.mutate(
      { id: o.id, amount: null, currency: null },
      { onSuccess: () => setEditId(null) },
    );

  if (me.isLoading) return null;
  if (!me.data?.authenticated) return <Navigate to="/login" replace />;

  const loading = owned.isLoading || stats.isLoading;

  return (
    <AppShell>
      <main className="relative max-w-6xl mx-auto px-6 py-16">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-24 left-0 right-0 h-[380px] -z-0"
          style={{
            background:
              "radial-gradient(46% 62% at 18% 0%, color-mix(in oklab, var(--color-or) 20%, transparent), transparent 70%), radial-gradient(44% 58% at 86% 6%, color-mix(in oklab, var(--color-jade) 14%, transparent), transparent 72%)",
            WebkitMaskImage:
              "linear-gradient(to right, transparent 0, #000 8%, #000 92%, transparent 100%)",
            maskImage:
              "linear-gradient(to right, transparent 0, #000 8%, #000 92%, transparent 100%)",
          }}
        />

        <Reveal as="header" className="relative mb-10">
          <span aria-hidden className="kanji-mark text-[24rem] -top-28 -right-6 hidden md:block">
            価
          </span>
          <p className="micro">{t("cote.eyebrow")}</p>
          <h1 className="display text-4xl md:text-5xl text-[var(--color-ivoire)] mt-2">
            <AccentTitle text={t("cote.title")} />
          </h1>
          <div className="gold-rule w-16 mt-4" />
          <p className="mt-5 text-[var(--color-ivoire-soft)] leading-relaxed max-w-2xl">
            {t("cote.body")}
          </p>
        </Reveal>

        {loading ? (
          <SectionSkeleton />
        ) : totalCount === 0 ? (
          <EmptyState t={t} />
        ) : (
          <>
            {/* ─── Value hero + KPI ─── */}
            <Reveal as="section" delay={0.05} className="grid md:grid-cols-[1.2fr_1fr] gap-8 md:gap-12 items-end mb-12">
              <div className="@container min-w-0">
                <span className="micro-tight block mb-2">{t("cote.estimated_total")}</span>
                <span className="flex items-baseline gap-2 min-w-0">
                  {/* Rounded to whole units in the hero: keeps the giant figure
                      free of a comma whose descender bled into the panel below.
                      Exact amounts (cents) stay in the KPIs and the rows. */}
                  {showFx ? (
                    // Converted: ≈ stays on the same line as the amount (a
                    // subordinate, smaller glyph). `figural-massive` lives on the
                    // *number* — its gold gradient is clipped to text, so putting
                    // it on the wrapper would stretch the gradient across "≈ 536 €"
                    // and leave the € on the dark end. Sized in `cqi` against the
                    // hero column so it scales to fit and never spills right.
                    <span className="inline-flex items-baseline whitespace-nowrap max-w-full leading-[0.9] pb-[0.06em]">
                      <span className="figural text-[clamp(1.5rem,6cqi,3.5rem)] text-[var(--color-or-pale)] mr-3">≈</span>
                      <span className="figural-massive text-[clamp(2.25rem,15cqi,6rem)]">
                        {fmtMoney(Math.round(dispValue), dispCur, locale)}
                      </span>
                    </span>
                  ) : (
                    <span className="figural-massive text-[clamp(4rem,11vw,8rem)] leading-[0.9] pb-[0.06em] inline-block">
                      {dispValue != null
                        ? fmtMoney(Math.round(dispValue), dispCur, locale)
                        : "—"}
                    </span>
                  )}
                </span>
                {showFx ? (
                  <p className="mt-3 text-[12px] text-[var(--color-ivoire-soft)]">
                    <span className="uppercase tracking-[0.18em] text-[10px] text-[var(--color-or-pale)]">
                      {t("fx.approx")}
                    </span>
                    {dc.date ? <span className="font-mono"> · {dc.date}</span> : null}
                    {serverEur?.partial ? (
                      <span className="text-[var(--color-laque-bright)]">
                        {" "}
                        · {t("fx.partial")}
                      </span>
                    ) : null}
                    {valueBuckets.length ? (
                      <span className="block font-mono mt-1">
                        {valueBuckets
                          .map((b) => fmtMoney(b.estimated_total, b.currency, locale))
                          .join(" · ")}
                      </span>
                    ) : null}
                  </p>
                ) : valueBuckets.length > 1 ? (
                  <p className="mt-3 text-[12px] text-[var(--color-ivoire-soft)] font-mono">
                    {valueBuckets.slice(1).map((b) => fmtMoney(b.estimated_total, b.currency, locale)).join(" · ")}
                  </p>
                ) : null}
              </div>

              <div className="grid gap-px bg-[color-mix(in_oklab,var(--color-or)_14%,transparent)] border border-[color-mix(in_oklab,var(--color-or)_14%,transparent)]">
                <Kpi label={t("cote.total_paid")}>
                  <span className="figural text-3xl">
                    {dispPaid != null ? (
                      <Money
                        amount={dispPaid}
                        currency={dispCur}
                        approx={showFx ? true : undefined}
                        round={showFx}
                      />
                    ) : (
                      "—"
                    )}
                  </span>
                </Kpi>
                <Kpi label={t("cote.plus_value")}>
                  {dispPlus != null && dispCur ? (
                    <span className={`figural text-3xl ${dispPlus >= 0 ? "text-[var(--color-jade)]" : "text-[var(--color-laque-bright)]"}`}>
                      {dispPlus >= 0 ? "+" : "−"}
                      <Money
                        amount={Math.abs(dispPlus)}
                        currency={dispCur}
                        approx={showFx ? true : undefined}
                        round={showFx}
                      />
                      {dispPlusPct != null ? (
                        <span className={`chip ml-2 align-middle ${dispPlus >= 0 ? "chip--jade" : "chip--laque"}`}>
                          {dispPlus >= 0 ? "+" : ""}{dispPlusPct.toFixed(1)} %
                        </span>
                      ) : null}
                    </span>
                  ) : (
                    <span className="text-[var(--color-ivoire-soft)] text-sm">{t("cote.no_paid")}</span>
                  )}
                </Kpi>
                <Kpi label={t("cote.pieces_valued")}>
                  <span className="figural text-3xl">{valuedCount}</span>
                  <span className="text-[var(--color-ivoire-soft)] text-base"> / {totalCount}</span>
                  {autoCount > 0 || msrpCount > 0 ? (
                    <span className="block mt-2 text-[11px] text-[var(--color-ivoire-soft)]">
                      {autoCount > 0 ? t("cote.auto_count", { n: autoCount }) : null}
                      {autoCount > 0 && msrpCount > 0 ? " · " : null}
                      {msrpCount > 0 ? t("cote.msrp_count", { n: msrpCount }) : null}
                    </span>
                  ) : null}
                </Kpi>
              </div>
            </Reveal>

            {/* ─── Market evolution (price-cron relevés) ─── */}
            {evo ? (
              <Reveal as="section" delay={0.08} className="mb-12" aria-label={t("cote.evo.title")}>
                <header className="mb-4">
                  <p className="micro flex items-center gap-2.5">
                    <span aria-hidden className="w-1 h-1 bg-[var(--color-laque-bright)] rotate-45" />
                    {t("cote.evo.kicker")}
                    <span aria-hidden className="ja not-italic text-[var(--color-or)]">推</span>
                    {t("cote.evo.kicker_label")}
                  </p>
                  <h2 className="display text-2xl md:text-3xl text-[var(--color-ivoire)] mt-2">
                    <AccentTitle text={t("cote.evo.title")} />
                  </h2>
                  <div className="gold-rule w-16 mt-3" />
                </header>

                <div className="flex items-center gap-1.5 flex-wrap mb-3">
                  {RANGES.map((r) => {
                    const on = range === r;
                    return (
                      <button
                        key={r}
                        type="button"
                        onClick={() => setRange(r)}
                        aria-pressed={on}
                        className="tap-target text-[10px] uppercase tracking-[0.18em] px-3 py-1.5 border transition-colors"
                        style={
                          on
                            ? {
                                color: "var(--color-or)",
                                borderColor: "color-mix(in oklab, var(--color-or) 60%, transparent)",
                                background: "color-mix(in oklab, var(--color-or) 10%, transparent)",
                              }
                            : {
                                color: "var(--color-ivoire-soft)",
                                borderColor: "color-mix(in oklab, var(--color-or) 22%, transparent)",
                              }
                        }
                      >
                        {t(`cote.evo.range.${r}`)}
                      </button>
                    );
                  })}
                  <span className="flex-1" />
                  {evoDelta ? (
                    <span className="font-mono text-sm text-[var(--color-ivoire)]">
                      {fmtMoney(evo[evo.length - 1].v, primary.currency, locale)}{" "}
                      <span
                        className="text-[12px]"
                        style={{
                          color:
                            evoDelta.abs >= 0 ? "var(--color-jade)" : "var(--color-laque-bright)",
                        }}
                      >
                        {evoDelta.abs >= 0 ? "▲ +" : "▼ −"}
                        {fmtMoney(Math.abs(evoDelta.abs), primary.currency, locale)} ·{" "}
                        {evoDelta.abs >= 0 ? "+" : "−"}
                        {Math.abs(evoDelta.pct).toFixed(1)} %
                      </span>
                    </span>
                  ) : null}
                </div>

                <StepChart
                  points={evo}
                  currency={primary.currency}
                  locale={locale}
                  height={210}
                  t={t}
                />
                <p className="mt-2 font-mono text-[9.5px] text-[var(--color-ivoire-soft)]/70">
                  {t("cote.evo.legend", { cur: primary.currency })}
                </p>
              </Reveal>
            ) : null}

            {/* ─── Ranked pieces (inline-editable) ─── */}
            <Reveal as="section" delay={0.1} className="bg-[color-mix(in_oklab,var(--color-noir-soft)_80%,transparent)] border border-[color-mix(in_oklab,var(--color-or)_16%,transparent)]">
              <div className="px-5 py-4 border-b border-[color-mix(in_oklab,var(--color-or)_14%,transparent)]">
                <div className="flex items-baseline justify-between">
                  <span className="micro-tight">{t("cote.ranked_title")}</span>
                  <span className="micro-tight text-[var(--color-ivoire-soft)]">{t("cote.ranked_cols")}</span>
                </div>
                <p className="mt-1.5 text-[11px] text-[var(--color-ivoire-soft)] flex items-center gap-1.5">
                  <span aria-hidden className="text-[var(--color-or-pale)]">✎</span>
                  {t("cote.edit_hint")}
                </p>
              </div>
              <ul>
                {ranked.map(({ o, ev, paid }) => {
                  const hue = typeHue(o.figure_type);
                  const delta =
                    ev && paid && ev.currency === paid.currency ? ev.amount - paid.amount : null;
                  const editing = editId === o.id;
                  const series = historyByFigure.get(o.figure_id) ?? [];
                  const sdelta = seriesDelta(series);
                  const expanded = openHist === o.figure_id && series.length >= 2;
                  return (
                    <li
                      key={o.id}
                      id={`figure-${o.figure_id}`}
                      className={`border-b border-[color-mix(in_oklab,var(--color-or)_8%,transparent)] last:border-0 ${editing ? "bg-[color-mix(in_oklab,var(--color-or)_5%,transparent)]" : ""}`}
                    >
                    <div className="grid grid-cols-[48px_1fr_auto] md:grid-cols-[48px_1fr_auto_auto] gap-4 items-center px-5 py-3">
                      <div
                        className="relative w-12 h-[60px] overflow-hidden border"
                        style={{ borderColor: `color-mix(in oklab, ${hue} 30%, transparent)` }}
                      >
                        <span
                          aria-hidden
                          className="absolute top-0 left-0 right-0 h-[2px]"
                          style={{ background: `linear-gradient(90deg, transparent, ${hue} 30%, ${hue} 70%, transparent)` }}
                        />
                        <span
                          aria-hidden
                          className="ja absolute inset-0 grid place-items-center text-2xl"
                          style={{ color: `color-mix(in oklab, ${hue} 55%, transparent)` }}
                        >
                          {typeKanji(o.figure_type)}
                        </span>
                      </div>

                      <div className="min-w-0">
                        <Link
                          to={`/figures/${o.figure_id}`}
                          className="display text-lg text-[var(--color-ivoire)] hover:text-[var(--color-or-pale)] transition-colors line-clamp-1"
                        >
                          {o.figure_name}
                        </Link>
                        <div className="mt-1 flex items-center gap-2 text-[11px] text-[var(--color-ivoire-soft)]">
                          <span className="chip">{t(`type.${o.figure_type}`)}</span>
                          {o.manufacturer_name ? <span className="font-mono truncate">{o.manufacturer_name}</span> : null}
                        </div>
                      </div>

                      {/* market trend — the sparkline toggles the registre */}
                      {series.length >= 2 ? (
                        <button
                          type="button"
                          onClick={() => setOpenHist(expanded ? null : o.figure_id)}
                          aria-expanded={expanded}
                          title={t("cote.history.evolution")}
                          className="hidden md:flex flex-col items-end gap-0.5"
                        >
                          <StepSparkline points={series} />
                          {sdelta ? (
                            <span
                              className="font-mono text-[9.5px]"
                              style={{
                                color:
                                  sdelta.abs >= 0
                                    ? "var(--color-jade)"
                                    : "var(--color-laque-bright)",
                              }}
                            >
                              {sdelta.abs >= 0 ? "▲ +" : "▼ −"}
                              {Math.abs(sdelta.pct).toFixed(1)} %
                            </span>
                          ) : null}
                        </button>
                      ) : (
                        <span aria-hidden className="hidden md:block w-[96px]" />
                      )}

                      {/* money / editor */}
                      {editing ? (
                        <div className="flex flex-col items-end gap-1.5">
                          <span className="inline-flex items-center border border-[var(--color-or)] bg-[var(--color-noir)]">
                            <span className="px-2 text-[var(--color-or-deep)] font-mono text-xs">
                              {o.value_currency || o.price_currency || prefCurrency}
                            </span>
                            <input
                              autoFocus
                              inputMode="decimal"
                              value={draft}
                              onChange={(e) => setDraft(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") saveEdit(o);
                                if (e.key === "Escape") setEditId(null);
                              }}
                              placeholder={o.msrp_amount != null ? String(o.msrp_amount) : "—"}
                              className="w-24 bg-transparent text-right text-[var(--color-ivoire)] font-mono text-sm py-1.5 pr-2 outline-none"
                            />
                          </span>
                          <div className="flex gap-1.5">
                            <button
                              type="button"
                              onClick={() => saveEdit(o)}
                              disabled={setValue.isPending}
                              className="text-[10px] uppercase tracking-[0.12em] px-2.5 py-1 bg-[var(--color-laque)] text-[var(--color-ivoire)] hover:bg-[var(--color-laque-bright)] transition-colors"
                            >
                              {t("editor.save")}
                            </button>
                            {o.value_amount != null ? (
                              <button
                                type="button"
                                onClick={() => resetMsrp(o)}
                                disabled={setValue.isPending}
                                className="text-[10px] uppercase tracking-[0.12em] px-2.5 py-1 border border-[color-mix(in_oklab,var(--color-or)_30%,transparent)] text-[var(--color-ivoire-soft)]"
                              >
                                ↺ MSRP
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setEditId(null)}
                                className="text-[10px] uppercase tracking-[0.12em] px-2.5 py-1 border border-[color-mix(in_oklab,var(--color-or)_30%,transparent)] text-[var(--color-ivoire-soft)]"
                              >
                                {t("editor.cancel")}
                              </button>
                            )}
                          </div>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => startEdit(o)}
                          title={t("cote.edit_value")}
                          className="flex items-center gap-2.5 group/val"
                        >
                          <span
                            aria-hidden
                            className="text-[13px] text-[color-mix(in_oklab,var(--color-or)_45%,transparent)] group-hover/val:text-[var(--color-or)] transition-colors"
                          >
                            ✎
                          </span>
                          <span className="text-right font-mono">
                            {paid ? (
                              <span className="block text-[11px] text-[var(--color-ivoire-soft)]">
                                {t("cote.paid_abbr")}{" "}
                                <Money amount={paid.amount} currency={paid.currency} />
                              </span>
                            ) : null}
                            <span className="block text-sm text-[var(--color-ivoire)] group-hover/val:text-[var(--color-or-pale)] transition-colors">
                              <Money amount={ev.amount} currency={ev.currency} />
                              {ev.source === "auto" ? (
                                <span className="ml-1.5 text-[9px] uppercase tracking-[0.14em] text-[var(--color-jade)] align-middle">
                                  {t("cote.market_badge")}
                                </span>
                              ) : ev.source === "msrp" ? (
                                <span className="ml-1.5 text-[9px] uppercase tracking-[0.14em] text-[var(--color-or-pale)] align-middle">
                                  MSRP
                                </span>
                              ) : null}
                            </span>
                            {delta != null ? (
                              <span className={`block text-[11px] ${delta >= 0 ? "text-[var(--color-jade)]" : "text-[var(--color-laque-bright)]"}`}>
                                {delta >= 0 ? "▲ +" : "▼ "}
                                <Money amount={Math.abs(delta)} currency={ev.currency} />
                              </span>
                            ) : null}
                          </span>
                        </button>
                      )}
                    </div>
                      {/* expanded registre — per-figure step chart + relevés */}
                      {expanded ? (
                        <div className="px-5 pb-4 md:pl-[84px]">
                          <div className="flex items-center gap-2 mb-2">
                            <span className="micro-tight text-[var(--color-or-pale)]">
                              {t("cote.history.registre")}
                            </span>
                            <span
                              aria-hidden
                              className="flex-1 h-px"
                              style={{
                                background:
                                  "color-mix(in oklab, var(--color-or) 20%, transparent)",
                              }}
                            />
                          </div>
                          <StepChart
                            points={series}
                            currency={ev?.currency}
                            locale={locale}
                            height={140}
                            t={t}
                          />
                          <div className="mt-2 max-h-40 overflow-y-auto">
                            <PriceLedger
                              points={series}
                              currency={ev?.currency}
                              locale={locale}
                              t={t}
                            />
                          </div>
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </Reveal>

            <p className="mt-5 text-[11.5px] leading-relaxed text-[var(--color-ivoire-soft)] border-l-2 border-[color-mix(in_oklab,var(--color-or)_35%,transparent)] pl-3 max-w-3xl">
              {t("cote.footnote")}
            </p>
          </>
        )}
      </main>
    </AppShell>
  );
}

function Kpi({ label, children }) {
  return (
    <div className="bg-[var(--color-noir)] px-5 py-4">
      <div className="micro-tight mb-2">{label}</div>
      <div className="leading-none">{children}</div>
    </div>
  );
}

function EmptyState({ t }) {
  return (
    <div className="text-center py-20">
      <p className="ja text-[6rem] text-[var(--color-or)]/30 leading-none">価</p>
      <p className="mt-3 text-[var(--color-ivoire-soft)] italic">{t("cote.empty")}</p>
      <Link
        to="/browse"
        className="inline-block mt-5 px-5 py-3 bg-[var(--color-laque)] text-[var(--color-ivoire)] text-[11px] uppercase tracking-[0.2em] hover:bg-[var(--color-laque-bright)] transition-colors"
      >
        {t("cote.empty_cta")}
      </Link>
    </div>
  );
}

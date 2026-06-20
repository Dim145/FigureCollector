import { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { useT } from "../i18n/index.jsx";
import { useMe } from "../hooks/useMe.js";
import { useOwnedItems, useSetOwnedValue } from "../hooks/useCollection.js";
import { useMyPriceHistory, useMyStats } from "../hooks/useStats.js";
import AppShell from "../components/AppShell.jsx";
import { PageLayout } from "../components/layout/index.js";
import { useDisplayCurrency } from "../components/DisplayCurrencyProvider.jsx";
import PriceHistoryDialog, { toSeries } from "../components/PriceHistory.jsx";
import { effectiveValue, figurePaid } from "../lib/money.js";
import CoteHeader from "./cote/CoteHeader.jsx";
import CoteEvolution from "./cote/CoteEvolution.jsx";
import CoteRanking from "./cote/CoteRanking.jsx";
import { CoteEmpty, CoteLoading, coteRow } from "./cote/coteShared.jsx";

// Range chips for the evolution chart (days of look-back; "all" = full history).
const RANGE_DAYS = { "3m": 91, "6m": 183, "1y": 365 };

/** `/insights/cote#figure-<uuid>` (the figure-page dialog's deep link). */
function hashFigureId() {
  const m = window.location.hash.match(/^#figure-([0-9a-f-]{36})$/i);
  return m ? m[1] : null;
}

/**
 * « La Cote » — collection-value dashboard (thin orchestrator).
 *
 * Owns the data hooks + the display-currency math, then composes the
 * page-local sections on the shared editorial foundation:
 *   CoteHeader     — the headline StatCard strip (total value · plus-value ·
 *                    pièces cotées · coût d'acquisition) + the FX footnote.
 *   CoteEvolution  — the reconstructed collection-value curve (dominant cur).
 *   CoteRanking    — every priced piece, sortable table → mobile cards, each
 *                    with the inline cote editor + a relevés trend.
 *
 * Amounts convert to the user's display currency at today's rate
 * (DisplayCurrencyProvider); the per-currency originals stay the footnote.
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
    ? (spendBuckets.find((s) => s.currency === primary.currency) ?? null)
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
  const convPlus = convValue != null && convPaid != null ? convValue - convPaid : null;
  const convPlusPct = convPlus != null && convPaid > 0 ? (convPlus / convPaid) * 100 : null;

  // What the headline shows — converted total (conversion on) or the dominant
  // per-currency bucket (off / no preferred currency).
  const showFx = fxActive && valueBuckets.length > 0;
  const dispCur = showFx ? dc.display : primary?.currency;
  const dispValue = showFx ? convValue : primary ? Number(primary.estimated_total) : null;
  const dispPaid = showFx ? convPaid : primaryPaid ? Number(primaryPaid.total) : null;
  const dispPlus = showFx ? convPlus : plusValue;
  const dispPlusPct = showFx ? convPlusPct : plusPct;

  const valuedCount = valueBuckets.reduce((a, b) => a + b.pieces_valued, 0);
  const autoCount = valueBuckets.reduce((a, b) => a + (b.pieces_auto ?? 0), 0);
  const msrpCount = valueBuckets.reduce((a, b) => a + b.pieces_msrp, 0);
  const totalCount = owned.data?.length ?? stats.data?.total_pieces ?? 0;

  // Every owned piece with a resolvable value, shaped for the ranking
  // (value + price + same-currency plus-value). Initial order is value desc;
  // the table re-sorts in place.
  const ranked = useMemo(() => {
    return (owned.data ?? [])
      .map((o) => coteRow(o, effectiveValue(o), figurePaid(o)))
      .filter((r) => r.ev)
      .sort((a, b) => b.ev.amount - a.ev.amount);
  }, [owned.data]);

  const [editId, setEditId] = useState(null);
  const [draft, setDraft] = useState("");

  // ----- Market-price history (the price cron's relevés) --------------------
  const history = useMyPriceHistory();
  const [range, setRange] = useState("all");
  // The relevés dialog, keyed by FIGURE id — seeded from the deep-link hash so
  // arriving from the figure-page dialog opens straight onto that piece.
  const [histFigureId, setHistFigureId] = useState(() => hashFigureId());

  // figure_id → sorted chart points; feeds sparklines, the dialog and the curve.
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

  // Collection evolution — "what the headline figure would have read at date T",
  // reconstructed per the cote chain (manual > auto > MSRP): manual values and
  // MSRP aren't historized so they contribute constants; provider prices
  // contribute their step series (MSRP fallback before a piece's 1st relevé).
  // Dominant currency only, mirroring the headline.
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
      const msrp = o.msrp_amount != null && eq(o.msrp_currency) ? Number(o.msrp_amount) : null;
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

  // Deep link from the figure-page dialog: once the rows exist in the DOM,
  // bring the hash-targeted card into view (the dialog opens via initial state).
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
  const histRow = histFigureId
    ? (owned.data ?? []).find((o) => o.figure_id === histFigureId)
    : null;
  const histPoints = histFigureId ? (historyByFigure.get(histFigureId) ?? []) : [];

  return (
    <AppShell>
      <PageLayout
        kicker={t("cote.kicker", { default: "ANALYSES · 価 · LA COTE" })}
        title={t("cote.title", { default: "La Cote" })}
        kanji="価"
        width="standard"
      >
        <p className="-mt-3 mb-8 max-w-2xl text-[var(--on-surface-muted)] leading-relaxed">
          {t("cote.body", {
            default:
              "Ce que vaut la vitrine, pièce par pièce. La plus-value se lit d'un coup d'œil.",
          })}
        </p>

        {loading ? (
          <CoteLoading t={t} />
        ) : totalCount === 0 ? (
          <CoteEmpty t={t} />
        ) : (
          <div className="space-y-[var(--space-section)]">
            <CoteHeader
              t={t}
              locale={locale}
              dispCur={dispCur}
              dispValue={dispValue}
              dispPaid={dispPaid}
              dispPlus={dispPlus}
              dispPlusPct={dispPlusPct}
              showFx={showFx}
              valuedCount={valuedCount}
              autoCount={autoCount}
              msrpCount={msrpCount}
              totalCount={totalCount}
              fx={{ date: dc.date, partial: serverEur?.partial }}
              valueBuckets={valueBuckets}
            />

            <CoteEvolution
              t={t}
              locale={locale}
              evo={evo}
              range={range}
              onRange={setRange}
              currency={primary?.currency}
            />

            {ranked.length > 0 ? (
              <CoteRanking
                rows={ranked}
                historyByFigure={historyByFigure}
                editId={editId}
                draft={draft}
                onDraft={setDraft}
                onStartEdit={startEdit}
                onSave={saveEdit}
                onCancel={() => setEditId(null)}
                onResetMsrp={resetMsrp}
                saving={setValue.isPending}
                onOpenHistory={(o) => setHistFigureId(o.figure_id)}
              />
            ) : null}

            <p className="text-[11.5px] leading-relaxed text-[var(--on-surface-muted)] border-l-2 border-[var(--accent)]/35 pl-3 max-w-3xl">
              {t("cote.footnote", {
                default:
                  "La valeur d'une pièce est saisie manuellement ; sans valeur saisie, on affiche le MSRP catalogue dans sa devise (badge « MSRP »).",
              })}
            </p>
          </div>
        )}
      </PageLayout>

      {/* Relevés dialog — shared domain component; deep-link opens it directly. */}
      <PriceHistoryDialog
        open={!!histRow && histPoints.length >= 2}
        onClose={() => setHistFigureId(null)}
        figureId={histFigureId}
        figureName={histRow?.figure_name}
        points={histPoints}
        currency={histPoints[0]?.currency || primary?.currency}
        locale={locale}
      />
    </AppShell>
  );
}

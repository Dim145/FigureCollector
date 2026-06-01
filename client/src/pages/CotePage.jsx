import { useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useT } from "../i18n/index.jsx";
import { useMe } from "../hooks/useMe.js";
import { useOwnedItems, useSetOwnedValue } from "../hooks/useCollection.js";
import { useMyStats } from "../hooks/useStats.js";
import { useFx } from "../hooks/useFx.js";
import AppShell from "../components/AppShell.jsx";
import Reveal from "../components/motion/Reveal.jsx";
import { typeHue, typeKanji } from "../lib/typeHue.js";
import { fmtMoney, effectiveValue, paidTotal, convertAmount } from "../lib/money.js";

/**
 * « La Cote » — collection-value dashboard.
 *
 * Hero: estimated total value (per dominant currency) + paid + latent
 * plus-value. Below: every owned piece ranked by value, each with an inline
 * editor for the manual valuation (the "cote"), falling back to the catalog
 * MSRP when none is set. Value source: manual + MSRP (no FX — amounts stay in
 * their own currency, aggregated per-currency like the rest of the app).
 */
export default function CotePage() {
  const t = useT();
  const me = useMe();
  const owned = useOwnedItems();
  const stats = useMyStats();
  const setValue = useSetOwnedValue();

  const locale = document.documentElement.lang || undefined;
  const prefCurrency = me.data?.user?.preferred_currency || "EUR";

  const valueBuckets = stats.data?.value_by_currency ?? [];
  const spendBuckets = stats.data?.spend_by_currency ?? [];
  const primary = valueBuckets[0] ?? null;
  const primaryPaid = primary
    ? spendBuckets.find((s) => s.currency === primary.currency) ?? null
    : null;
  const plusValue =
    primary && primaryPaid ? Number(primary.estimated_total) - Number(primaryPaid.grand_total) : null;
  const plusPct =
    plusValue != null && primaryPaid && Number(primaryPaid.grand_total) > 0
      ? (plusValue / Number(primaryPaid.grand_total)) * 100
      : null;

  // Optional display-currency overlay (off by default). Sums every per-currency
  // bucket into the chosen display currency — approximate, never stored; the
  // per-currency truth stays the footnote below the converted figure.
  const fx = useFx();
  const fxReady = fx.convert && Object.keys(fx.rates).length > 0;
  const sumConverted = (buckets, field) =>
    buckets.reduce((sum, b) => {
      const c = convertAmount(b[field], b.currency, fx);
      return c == null ? sum : sum + c;
    }, 0);
  const convValue = fxReady ? sumConverted(valueBuckets, "estimated_total") : null;
  const convPaid = fxReady ? sumConverted(spendBuckets, "grand_total") : null;
  const convPlus = convValue != null && convPaid != null ? convValue - convPaid : null;
  const convPlusPct =
    convPlus != null && convPaid > 0 ? (convPlus / convPaid) * 100 : null;

  // Which figures the hero/KPIs actually show — converted (overlay on) or the
  // dominant per-currency bucket (overlay off).
  const showFx = fxReady && convValue != null;
  const dispPaid = showFx ? convPaid : primaryPaid ? Number(primaryPaid.grand_total) : null;
  const dispPlus = showFx ? convPlus : plusValue;
  const dispPlusPct = showFx ? convPlusPct : plusPct;
  const dispCur = showFx ? fx.display : primary?.currency;

  const valuedCount = valueBuckets.reduce((a, b) => a + b.pieces_valued, 0);
  const msrpCount = valueBuckets.reduce((a, b) => a + b.pieces_msrp, 0);
  const totalCount = owned.data?.length ?? stats.data?.total_pieces ?? 0;

  // Every owned piece with a resolvable value, ranked high → low. Doubles as
  // the bulk-valuation surface (each row is inline-editable).
  const ranked = useMemo(() => {
    return (owned.data ?? [])
      .map((o) => ({ o, ev: effectiveValue(o), paid: paidTotal(o) }))
      .filter((r) => r.ev)
      .sort((a, b) => b.ev.amount - a.ev.amount);
  }, [owned.data]);

  const [editId, setEditId] = useState(null);
  const [draft, setDraft] = useState("");

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
        {/* gold-leaning hero wash */}
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

        {/* ─── Hero ─── */}
        <Reveal as="header" className="relative mb-10">
          <span aria-hidden className="kanji-mark text-[24rem] -top-28 -right-6 hidden md:block">
            価
          </span>
          <p className="micro">{t("cote.eyebrow")}</p>
          <h1 className="display text-4xl md:text-5xl text-[var(--color-ivoire)] mt-2">
            {t("cote.title")}
          </h1>
          <div className="gold-rule w-16 mt-4" />
          <p className="mt-5 text-[var(--color-ivoire-soft)] leading-relaxed max-w-2xl">
            {t("cote.body")}
          </p>
        </Reveal>

        {loading ? (
          <p className="text-center text-[var(--color-ivoire-soft)] py-16">…</p>
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
                  {fxReady && convValue != null ? (
                    // Converted: ≈ stays on the same line as the amount (a
                    // subordinate, smaller glyph). `figural-massive` lives on the
                    // *number* — its gold gradient is clipped to text, so putting
                    // it on the wrapper would stretch the gradient across "≈ 536 €"
                    // and leave the € on the dark end. Sized in `cqi` against the
                    // hero column so it scales to fit and never spills right.
                    <span className="inline-flex items-baseline whitespace-nowrap max-w-full leading-[0.9] pb-[0.06em]">
                      <span className="figural text-[clamp(1.5rem,6cqi,3.5rem)] text-[var(--color-or-pale)] mr-3">≈</span>
                      <span className="figural-massive text-[clamp(2.25rem,15cqi,6rem)]">
                        {fmtMoney(Math.round(convValue), fx.display, locale)}
                      </span>
                    </span>
                  ) : (
                    <span className="figural-massive text-[clamp(4rem,11vw,8rem)] leading-[0.9] pb-[0.06em] inline-block">
                      {primary
                        ? fmtMoney(Math.round(Number(primary.estimated_total)), primary.currency, locale)
                        : "—"}
                    </span>
                  )}
                </span>
                {fxReady && convValue != null ? (
                  <p className="mt-3 text-[12px] text-[var(--color-ivoire-soft)]">
                    <span className="uppercase tracking-[0.18em] text-[10px] text-[var(--color-or-pale)]">
                      {t("fx.approx")}
                    </span>
                    {fx.date ? <span className="font-mono"> · {fx.date}</span> : null}
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
                    {dispPaid != null
                      ? `${showFx ? "≈ " : ""}${fmtMoney(showFx ? Math.round(dispPaid) : dispPaid, dispCur, locale)}`
                      : "—"}
                  </span>
                </Kpi>
                <Kpi label={t("cote.plus_value")}>
                  {dispPlus != null && dispCur ? (
                    <span className={`figural text-3xl ${dispPlus >= 0 ? "text-[var(--color-jade)]" : "text-[var(--color-laque-bright)]"}`}>
                      {showFx ? "≈ " : ""}{dispPlus >= 0 ? "+" : ""}
                      {fmtMoney(showFx ? Math.round(dispPlus) : dispPlus, dispCur, locale)}
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
                  {msrpCount > 0 ? (
                    <span className="block mt-2 text-[11px] text-[var(--color-ivoire-soft)]">
                      {t("cote.msrp_count", { n: msrpCount })}
                    </span>
                  ) : null}
                </Kpi>
              </div>
            </Reveal>

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
                  return (
                    <li
                      key={o.id}
                      className={`grid grid-cols-[48px_1fr_auto] gap-4 items-center px-5 py-3 border-b border-[color-mix(in_oklab,var(--color-or)_8%,transparent)] last:border-0 ${editing ? "bg-[color-mix(in_oklab,var(--color-or)_5%,transparent)]" : ""}`}
                    >
                      {/* thumb */}
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

                      {/* meta */}
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
                              className="text-[10px] uppercase tracking-[0.12em] px-2.5 py-1 bg-[var(--color-or)] text-[var(--color-noir)]"
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
                                {t("cote.paid_abbr")} {fmtMoney(paid.amount, paid.currency, locale)}
                              </span>
                            ) : null}
                            <span className="block text-sm text-[var(--color-ivoire)] group-hover/val:text-[var(--color-or-pale)] transition-colors">
                              {fmtMoney(ev.amount, ev.currency, locale)}
                              {!ev.isManual ? (
                                <span className="ml-1.5 text-[9px] uppercase tracking-[0.14em] text-[var(--color-or-pale)] align-middle">
                                  MSRP
                                </span>
                              ) : null}
                            </span>
                            {delta != null ? (
                              <span className={`block text-[11px] ${delta >= 0 ? "text-[var(--color-jade)]" : "text-[var(--color-laque-bright)]"}`}>
                                {delta >= 0 ? "▲ +" : "▼ "}
                                {fmtMoney(Math.abs(delta), ev.currency, locale)}
                              </span>
                            ) : null}
                          </span>
                        </button>
                      )}
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
        className="inline-block mt-5 px-5 py-3 bg-[var(--color-or)] text-[var(--color-noir)] text-[11px] uppercase tracking-[0.2em] hover:bg-[var(--color-or-pale)] transition-colors"
      >
        {t("cote.empty_cta")}
      </Link>
    </div>
  );
}

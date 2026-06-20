import { useMemo } from "react";
import Card from "../../components/Card.jsx";
import CountUp from "../../components/CountUp.jsx";
import Money from "../../components/Money.jsx";
import Reveal from "../../components/motion/Reveal.jsx";
import { useDisplayCurrency } from "../../components/DisplayCurrencyProvider.jsx";
import { appLocale } from "../../lib/locale.js";
import { sumInDisplay } from "../../lib/money.js";
import ChapterRule from "./ChapterRule.jsx";
import { CHAPTER_ACCENT, colorMix, fmtAmount } from "./chapterTheme.js";
import Sparkline from "./charts/Sparkline.jsx";

/**
 * II — Dépenses. The spend ledger (all-in outlay per currency, with the
 * display-currency rollup + item/shipping/catalog breakdown) beside the
 * pré-commande lifecycle dial. Desktop = two columns; mobile collapses to one.
 */
export default function SpendChapter({ data, t }) {
  return (
    <>
      <ChapterRule
        id="ch-spend"
        roman="II"
        label={t("stats.ch.spend")}
        kanji="財"
        accent={CHAPTER_ACCENT.II}
      />
      <Reveal as="div" y={24} className="grid lg:grid-cols-[1.4fr_1fr] gap-8 items-start">
        <SpendLedger data={data} t={t} />
        <PreorderDial data={data} t={t} />
      </Reveal>
    </>
  );
}

function SpendLedger({ data, t }) {
  const dc = useDisplayCurrency();
  // acquisitions_by_year (last ~8) is a soft proxy for buying intensity — the
  // sparkline is labelled as such, not as money over time.
  const yearProxy = useMemo(
    () => (data.acquisitions_by_year ?? []).slice(-8),
    [data.acquisitions_by_year],
  );

  // One all-in SPEND figure across every currency, in the display currency:
  // the total outlay incl. shipping (`data.eur.spend`, costs at the rate frozen
  // at purchase). Differs intentionally from La Cote's figure-cost-only "payé".
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
      <p className="display italic text-lg mb-5" style={{ color: "var(--color-neon-amber)" }}>
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
              <span className="text-[var(--color-laque-bright)]"> · {t("fx.partial")}</span>
            ) : null}
          </p>
        </div>
      ) : null}

      {buckets.length === 0 ? (
        <p className="text-[var(--color-ivoire-soft)] italic">{t("stats.spend.empty")}</p>
      ) : (
        <ul className="-mt-1">
          {buckets.map((s) => (
            <SpendRow key={s.currency} row={s} yearProxy={yearProxy} t={t} />
          ))}
        </ul>
      )}
    </Card>
  );
}

/** One ledger row: brass tab, big grand-total figure, item/shipping/catalog
 *  breakdown, and a delta-vs-catalog tag when the gap is interesting. */
function SpendRow({ row, yearProxy, t }) {
  const locale = appLocale();
  const grand = Number(row.grand_total ?? row.total) || 0;
  const item = Number(row.total) || 0;
  const shipping = Number(row.shipping_total) || 0;
  const catalog = Number(row.catalog_total) || 0;
  const hasShipping = shipping > 0.005;
  const hasCatalog = catalog > 0.005;
  // Delta compares figure cost only (`item`) vs catalog MSRP — mixing shipping
  // would always read as overpaying (shipping is non-negative).
  const delta = hasCatalog ? item - catalog : 0;
  const deltaPct = hasCatalog && catalog > 0 ? (delta / catalog) * 100 : 0;
  const showDelta = hasCatalog && Math.abs(delta) > 0.01;

  return (
    <li className="ledger-row">
      <span className="brass-tab">{row.currency}</span>
      <div className="min-w-0">
        <p className="ledger-figure">{fmtAmount(grand, row.currency, locale)}</p>
        <p className="ledger-caption mt-1">
          {t("stats.spend.priced_pieces", { count: row.pieces_priced })}
        </p>
        {hasShipping || hasCatalog ? (
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 max-w-xs text-[10.5px]">
            <Bd
              label={t("stats.spend.row.item")}
              value={fmtAmount(item, row.currency, locale)}
              currency={row.currency}
            />
            {hasShipping ? (
              <Bd
                label={t("stats.spend.row.shipping")}
                value={fmtAmount(shipping, row.currency, locale)}
                currency={row.currency}
              />
            ) : null}
            {hasCatalog ? (
              <Bd
                label={t("stats.spend.row.catalog")}
                value={fmtAmount(catalog, row.currency, locale)}
                currency={row.currency}
                dim
              />
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
                  amount: fmtAmount(Math.abs(delta), row.currency, locale),
                  currency: row.currency,
                  pct: deltaPct.toFixed(0),
                })
              : t("stats.spend.under_catalog", {
                  amount: fmtAmount(Math.abs(delta), row.currency, locale),
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

/** Tiny breakdown row inside the ledger entry. */
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
        className={`font-mono ${dim ? "text-[var(--color-ivoire-soft)]/70" : "text-[var(--color-ivoire)]"}`}
      >
        {value} <span className="text-[var(--color-or-pale)]/50">{currency}</span>
      </dd>
    </>
  );
}

function toneColor(tone) {
  switch (tone) {
    case "gold":
      return "text-[var(--color-or)]";
    case "gold-pale":
      return "text-[var(--color-or-pale)]";
    case "jade":
      return "text-[var(--color-jade)]";
    case "dim":
      return "text-[var(--color-ivoire-soft)]/60";
    case "ivory":
    default:
      return "text-[var(--color-ivoire)]";
  }
}

function PreorderDial({ data, t }) {
  const p = data.preorders;
  const total = (p.placed || 0) + (p.received || 0) + (p.cancelled || 0);
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
      <p className="display italic text-lg mb-5" style={{ color: "var(--color-jade)" }}>
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

import { useMemo } from "react";
import { useFigurePriceHistory } from "../../hooks/useStats.js";
import { effectiveValue, figurePaid } from "../../lib/money.js";
import { appLocale } from "../../lib/locale.js";
import Money from "../../components/Money.jsx";
import { StepChart, PriceLedger, toSeries } from "../../components/PriceHistory.jsx";

/**
 * #valeur — the value trio (cote / payé / plus-value, sign + arrow,
 * tabular-nums) over the FULL price-history ledger chart (reusing the shared
 * StepChart + PriceLedger from components/PriceHistory.jsx).
 *
 * Owned-only: the trio derives from the owned record (paid vs effective value,
 * same logic as the hero's OwnerGlance). When not owned this section isn't
 * rendered by the orchestrator (it has no value to compute), so we assume
 * `owned` is present.
 */
export default function ValueSection({ f, owned, t }) {
  const locale = appLocale();
  const hist = useFigurePriceHistory(f.id);
  const series = useMemo(() => toSeries(hist.data), [hist.data]);

  const value = effectiveValue({
    value_amount: owned.value_amount,
    value_currency: owned.value_currency,
    price_currency: owned.price_currency,
    provider_price_amount: owned.provider_price_amount,
    provider_price_currency: owned.provider_price_currency,
    msrp_amount: f.msrp_amount,
    msrp_currency: f.msrp_currency,
  });
  const paid = figurePaid(owned);
  const sameCurrency = paid && value && (paid.currency || "") === (value.currency || "");
  const gain = sameCurrency && paid.amount > 0 ? value.amount - paid.amount : null;
  const gainPct = gain != null && paid.amount > 0 ? Math.round((gain / paid.amount) * 100) : null;
  const up = gain != null && gain >= 0;
  const currency = value?.currency || paid?.currency || null;

  return (
    <div className="fig-value-grid">
      <div className="fig-trio-strip">
        <div className="fig-trio-cell cote">
          <div className="k">{t("figure.glance.current_value", { default: "Cote actuelle" })}</div>
          <div className="v tabular-nums">
            {value ? <Money amount={value.amount} currency={value.currency} /> : "—"}
          </div>
        </div>
        <div className="fig-trio-cell paye">
          <div className="k">{t("cote.paid_abbr")}</div>
          <div className="v tabular-nums">
            {paid ? <Money amount={paid.amount} currency={paid.currency} /> : "—"}
          </div>
          {owned.purchase_date ? (
            <div className="vv tabular-nums">
              {t("cote.acquired_on", { default: "acquis le" })}{" "}
              {new Date(owned.purchase_date).toLocaleDateString(locale)}
            </div>
          ) : null}
        </div>
        {gain != null ? (
          <div className="fig-trio-cell gain-cell">
            <div className="k">
              {up
                ? t("figure.glance.gain", { default: "Plus-value latente" })
                : t("figure.glance.loss", { default: "Moins-value latente" })}
            </div>
            <div className="v tabular-nums" style={{ color: up ? "var(--color-jade)" : "var(--color-laque-bright)" }}>
              <span className="arr" aria-hidden>
                {up ? "▲" : "▼"}
              </span>
              {gain > 0 ? "+" : ""}
              <Money amount={gain} currency={currency} />
            </div>
            {gainPct != null ? (
              <div
                className="vv tabular-nums"
                style={{ color: up ? "var(--color-jade)" : "var(--color-laque-bright)" }}
              >
                {gainPct > 0 ? "+" : ""}
                {gainPct} %
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {series.length >= 1 ? (
        <div className="fig-chart-card">
          <div className="fig-chart-head">
            <span className="ttl">{t("cote.history.evolution")}</span>
            {value ? (
              <span className="now tabular-nums">
                <Money amount={value.amount} currency={value.currency} />
              </span>
            ) : null}
          </div>
          <StepChart points={series} currency={currency} locale={locale} height={170} t={t} />
          <div className="fig-chart-ledger">
            <PriceLedger points={series} currency={currency} locale={locale} t={t} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

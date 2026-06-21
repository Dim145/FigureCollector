import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useFigurePriceHistory } from "../../hooks/useStats.js";
import { useFigureValuation } from "../../hooks/useFigureValuation.js";
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

  // Shared derivation — same source the sticky rail's glance reads, so the two
  // can never disagree on the gain.
  const { value, paid, gain, gainPct, up, currency } = useFigureValuation(f, owned);

  return (
    <div className="fig-value-grid">
      <div className="fig-value-left">
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

      {gainPct != null && gainPct !== 0 ? (
        <figure className="fig-pullquote">
          <blockquote className="fig-pullquote-q">
            «&nbsp;
            <span className="hl tabular-nums">
              {gainPct > 0 ? "+" : ""}
              {gainPct}&nbsp;%
            </span>{" "}
            {up
              ? t("figure.value.quote_up", { default: "depuis l'acquisition." })
              : t("figure.value.quote_down", { default: "sous le prix d'achat." })}
            &nbsp;»
          </blockquote>
          <figcaption className="fig-pullquote-by">
            {series.length >= 2
              ? t("figure.value.quote_by", {
                  count: series.length,
                  default: `Historique · ${series.length} relevés`,
                })
              : t("cote.title")}
          </figcaption>
        </figure>
      ) : null}
      </div>

      <div className="fig-chart-card">
        <div className="fig-chart-head">
          <span className="ttl">{t("cote.history.evolution")}</span>
          {value ? (
            <span className="now tabular-nums">
              <Money amount={value.amount} currency={value.currency} />
            </span>
          ) : null}
        </div>

        {/* ≥2 relevés → the full step-chart + ledger; otherwise a quiet,
         *  on-skin empty state. The "Voir dans la Cote" link is always present
         *  so the full cote page is one tap away. */}
        {series.length >= 2 ? (
          <>
            <StepChart points={series} currency={currency} locale={locale} height={170} t={t} />
            <div className="fig-chart-ledger">
              <PriceLedger points={series} currency={currency} locale={locale} t={t} />
            </div>
          </>
        ) : (
          <p className="fig-chart-empty">
            {t("figure.value.no_history", { default: "Pas encore d'historique" })}
          </p>
        )}

        <Link to="/insights/cote" className="fig-chart-cote-link">
          {t("figure.value.see_in_cote", { default: "Voir dans la Cote" })} →
        </Link>
      </div>
    </div>
  );
}

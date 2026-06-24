import { usePreorderForOwned } from "../../hooks/useCollection.js";
import { appLocale } from "../../lib/locale.js";
import { fmtMoney } from "../../lib/money.js";
import {
  deliveryCountdown,
  deliveryDateLabel,
  formatCountdown,
} from "../../lib/deliveryCountdown.js";
import Money from "../../components/Money.jsx";
import TrackingChip from "../../components/TrackingChip.jsx";

/**
 * Horizontal pré-commande timeline — the ④ L'Estampe design ported into the
 * ⓪ La Fiche shell (`.pc-*` classes). Renders the production phase rail, the
 * current-vs-struck-through release date with a delay badge, and a determinate
 * deposit bar with the remaining balance.
 *
 * Wired to the real linked preorder (`usePreorderForOwned`) + the catalog
 * `f.release_date`. The phase rail is derived from `po.status`; dates from
 * `release_date_original` / `release_date_current`; the deposit from
 * `deposit_amount` against the figurine total (owned price, else MSRP) — the
 * same total the OwnerGlance acompte bar and the editor use.
 *
 * NOTE: there is no `next_payment_date` field on the preorder record, so the
 * mockup's dated "prochain prélèvement" line is intentionally NOT rendered;
 * instead we surface the remaining balance + (when shipped) the delivery ETA,
 * and the always-true "acompte non-remboursable" caution.
 *
 * Renders nothing when no preorder data is meaningful (no linked row AND no
 * future release date) — the section wrapper hides the whole block then.
 */

// The five UI phases shown on the rail, in order. Each owned-preorder status
// maps to the rail index it has reached (everything ≤ that index is "done").
const STEPS = [
  { key: "announced", labelKey: "figure.preco.step.announced" },
  { key: "preorder", labelKey: "figure.preco.step.preorder" },
  { key: "production", labelKey: "figure.preco.step.production" },
  { key: "shipped", labelKey: "figure.preco.step.shipped" },
  { key: "received", labelKey: "figure.preco.step.received" },
];

/** DB status → the index of the rail step that is *current*. */
function stepIndexFromStatus(status) {
  switch (status) {
    case "announced":
      return 0;
    case "preorder_open":
    case "preordered":
      return 1;
    case "in_production":
      return 2;
    case "released":
    case "shipped":
      return 3;
    case "received":
      return 4;
    case "cancelled":
      return -1; // no current step — the order was dropped
    default:
      return 1; // a linked-but-unknown status sits at "pré-commande"
  }
}

function fmtDate(d, opts) {
  if (!d) return null;
  const parsed = new Date(d);
  if (Number.isNaN(parsed.getTime())) return String(d);
  return parsed.toLocaleDateString(appLocale(), opts);
}

function monthsBetween(a, b) {
  const da = new Date(a);
  const db = new Date(b);
  if (Number.isNaN(da.getTime()) || Number.isNaN(db.getTime())) return null;
  const months =
    (db.getFullYear() - da.getFullYear()) * 12 + (db.getMonth() - da.getMonth());
  return months;
}

export default function PreorderTimeline({ f, owned, t }) {
  const preorder = usePreorderForOwned(owned?.id);
  const po = preorder.data ?? null;

  // Dates: prefer the preorder slip dates, fall back to the catalog release.
  const current = po?.release_date_current ?? f.release_date ?? null;
  const original = po?.release_date_original ?? null;
  const slipped = original && current && original !== current;
  const delayMonths = slipped ? monthsBetween(original, current) : null;

  const status = po?.status ?? null;
  const currentStep = status ? stepIndexFromStatus(status) : null;
  const cancelled = status === "cancelled";

  // Deposit against the figurine total (owned price → MSRP fallback).
  const deposit = po?.deposit_amount != null ? Number(po.deposit_amount) : null;
  const total =
    owned?.price_amount != null
      ? Number(owned.price_amount)
      : f.msrp_amount != null
        ? Number(f.msrp_amount)
        : null;
  const currency = owned?.price_currency || po?.price_currency || f.msrp_currency || null;
  const hasDeposit = deposit != null && deposit > 0 && total != null && total > 0;
  // Explicit "balance settled" date the owner can set (the remaining balance is
  // typically billed weeks BEFORE shipment), independent of the order status.
  const balancePaidAt = po?.balance_paid_at ?? null;
  // …or recorded implicitly by raising the acompte to the full price
  // (deposit ≥ total ⇒ nothing left to owe).
  const fullyPaidByDeposit = hasDeposit && deposit >= total;
  // Shipped or received ⇒ the maker took the balance before sending; or the
  // balance was recorded paid (either way above). The order is then settled:
  // show it fully paid rather than still owing. Keyed off the status string,
  // not the step index — "released" alone (the product hit the market) does
  // NOT mean the buyer has paid their balance.
  const settled =
    !cancelled &&
    (status === "shipped" ||
      status === "received" ||
      fullyPaidByDeposit ||
      balancePaidAt != null);
  const depositPct = hasDeposit
    ? Math.max(0, Math.min(100, Math.round((deposit / total) * 100)))
    : 0;
  const pct = settled ? 100 : depositPct;
  const balance = hasDeposit ? Math.max(0, total - deposit) : null;
  // Human-readable announcement for the deposit progressbar — a screen reader
  // would otherwise read only the bare "… 34 %" with no money context.
  const depositValueText = hasDeposit
    ? settled
      ? t("figure.preco.fully_paid", { default: "Payé intégralement" })
      : t("figure.preco.deposit_aria", {
          paid: fmtMoney(deposit, currency, appLocale()),
          total: fmtMoney(total, currency, appLocale()),
          pct: depositPct,
          default: `${fmtMoney(deposit, currency, appLocale())} payé sur ${fmtMoney(total, currency, appLocale())} · ${depositPct} %`,
        })
    : undefined;

  // Delivery ETA — only meaningful once shipped with an estimate.
  const etaDays = deliveryCountdown(po);
  const etaDate = deliveryDateLabel(po);

  // Carrier tracking — the live chip the owner pings, relocated here from the
  // owner zone so all pre-order tracking lives in #preco.
  const trackingUrl = po?.tracking_url ?? null;

  // Nothing worth drawing? bail (parent hides the section).
  if (!current && currentStep == null) return null;

  return (
    <div className={`pc-preco ${cancelled ? "is-cancelled" : ""}`}>
      <div className="pc-preco-top">
        <div className="pc-slip-dates">
          {current ? (
            <span className="pc-now">
              <span className="ja-s" aria-hidden>
                発売
              </span>
              {fmtDate(current, { day: "numeric", month: "long", year: "numeric" })}
            </span>
          ) : null}
          <span className="pc-lbl">
            {t("figure.preco.current_release", { default: "Sortie actuelle" })}
          </span>
          {slipped ? (
            <span className="pc-was tabular-nums">
              {t("figure.preco.announced_short", { default: "Annoncée" })}{" "}
              {fmtDate(original, { day: "numeric", month: "short", year: "numeric" })}
            </span>
          ) : null}
        </div>
        {cancelled ? (
          /* Convey the cancelled state by TEXT (reusing the hanko-red outline
             of .pc-delay-badge) rather than by the dimmed .is-cancelled opacity
             alone — colour/appearance is not a sufficient signal (WCAG 1.4.1). */
          <span className="pc-delay-badge">
            {t("figure.preco.cancelled", { default: "Pré-commande annulée" })}
          </span>
        ) : slipped ? (
          <span className="pc-delay-badge">
            {delayMonths != null && delayMonths > 0
              ? t("figure.preco.delayed_months", {
                  count: delayMonths,
                  default: `Retardée · +${delayMonths} mois`,
                })
              : t("figure.preco.delayed", { default: "Retardée" })}
          </span>
        ) : null}
      </div>

      {/* Horizontal release-slip steps */}
      {currentStep != null ? (
        <ol className="pc-steps" aria-label={t("figure.preco.steps_aria", { default: "Étapes de production" })}>
          {STEPS.map((s, i) => {
            const done = !cancelled && currentStep > i;
            const isCurrent = !cancelled && currentStep === i;
            return (
              <li
                key={s.key}
                className={`pc-step ${done ? "done" : ""} ${isCurrent ? "current" : ""}`}
                aria-current={isCurrent ? "step" : undefined}
              >
                <span className="pc-node" aria-hidden />
                <div className="s-name">{t(s.labelKey, { default: s.key })}</div>
              </li>
            );
          })}
        </ol>
      ) : null}

      {/* Deposit bar — determinate "X payé sur Y · ≈Z %" */}
      {hasDeposit ? (
        <div className="pc-deposit">
          <p className="dhd">
            <span>{t("figure.glance.deposit_paid", { default: "Acompte versé" })}</span>
            <b className="tabular-nums">
              <Money amount={deposit} currency={currency} />
              {settled ? (
                <> · {t("figure.preco.settled", { default: "réglé" })}</>
              ) : (
                <>
                  {" "}
                  {t("figure.preco.paid_on", { default: "payé sur" })}{" "}
                  <Money amount={total} currency={currency} /> · ≈ {depositPct} %
                </>
              )}
            </b>
          </p>
          <div
            className="pc-bar"
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuetext={depositValueText}
            aria-label={t("figure.glance.acompte", { default: "Pré-commande · acompte" })}
          >
            <span className="pc-fill" style={{ width: `${pct}%` }} />
          </div>
          <div className="pc-dfoot tabular-nums">
            {settled ? (
              <span className="paid">
                ✓ {t("figure.preco.fully_paid", { default: "Payé intégralement" })}
                {balancePaidAt ? (
                  <span className="paid-on">
                    {" · "}
                    {fmtDate(balancePaidAt, { day: "numeric", month: "short", year: "numeric" })}
                  </span>
                ) : null}
              </span>
            ) : (
              <span>
                {t("figure.glance.balance_due", { default: "Solde restant" })}{" "}
                <b>
                  <Money amount={balance} currency={currency} />
                </b>
              </span>
            )}
            {etaDays != null ? (
              <span
                className="next"
                title={etaDate ? t("preorder.delivery.tooltip", { date: etaDate }) : undefined}
              >
                {t("figure.preco.delivery", { default: "Livraison" })}{" "}
                <b>{formatCountdown(etaDays, t)}</b>
              </span>
            ) : null}
            {settled ? null : (
              <span className="warn">
                ⚠ {t("figure.preco.non_refundable", { default: "Acompte non-remboursable" })}
              </span>
            )}
          </div>
        </div>
      ) : null}

      {/* Carrier tracking — the live chip the owner pings (only when the linked
       *  preorder carries a tracking URL). Consolidated here with the slip
       *  timeline; it no longer lives in the owner zone. */}
      {trackingUrl ? (
        <div className="pc-tracking">
          <span className="pc-tracking-lbl">
            <span className="ja-s" aria-hidden>
              追跡
            </span>
            {t("preorders.tracking.carrier")}
          </span>
          <TrackingChip url={trackingUrl} />
        </div>
      ) : null}
    </div>
  );
}

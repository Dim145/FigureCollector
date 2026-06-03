import { useT } from "../i18n/index.jsx";
import {
  usePreorderForOwned,
  usePreorderHistory,
} from "../hooks/useCollection.js";
import {
  countdownTone,
  deliveryCountdown,
  deliveryDateLabel,
  formatCountdown,
} from "../lib/deliveryCountdown.js";

/**
 * Persistent pre-order history block rendered under an owned piece. Stays
 * visible *after* the order has been received so the collector can look back
 * at announced vs delivered dates and the slip history.
 *
 * If the owned_item has no linked preorder (released figurines, etc.), this
 * renders nothing.
 */
export default function PreorderHistory({ ownedId }) {
  const t = useT();
  const preorder = usePreorderForOwned(ownedId);
  const history = usePreorderHistory(preorder.data?.id);

  if (preorder.isLoading) return null;
  const po = preorder.data;
  if (!po) return null;

  const phase = phaseFromStatus(po.status);
  const slipped =
    po.release_date_original &&
    po.release_date_current &&
    po.release_date_original !== po.release_date_current;

  return (
    <section aria-labelledby="preorder-history-title">
      <header className="mb-5">
        <p className="micro">{t("preorder.history.eyebrow")}</p>
        <h2
          id="preorder-history-title"
          className="display text-2xl text-[var(--color-ivoire)] mt-1"
        >
          {t("preorder.history.title")}
        </h2>
        <div className="gold-rule w-12 mt-3 opacity-70" />
      </header>

      <div className="grid sm:grid-cols-2 gap-4">
        <DateCard
          label={t("preorder.history.announced")}
          value={fmtDate(po.release_date_original)}
        />
        <DateCard
          label={t("preorder.history.released")}
          value={fmtDate(po.release_date_current)}
          highlight={slipped}
          slipNote={slipped ? t("preorder.history.slipped_note") : null}
        />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3 text-[11px] uppercase tracking-[0.22em]">
        <span className={statusPillClasses(phase)}>
          {t(`preorder.status.${po.status}`, { default: po.status })}
        </span>
        {po.store_name ? (
          <span className="text-[var(--color-ivoire-soft)]">
            {t("preorder.history.store")}{" "}
            <span className="text-[var(--color-or-pale)] normal-case tracking-normal">
              {po.store_name}
            </span>
          </span>
        ) : null}
        {po.order_ref ? (
          <span className="text-[var(--color-ivoire-soft)]">
            {t("preorder.history.order_ref")}{" "}
            <code className="text-[var(--color-or-pale)]">{po.order_ref}</code>
          </span>
        ) : null}
        {po.deposit_amount ? (
          <span className="text-[var(--color-ivoire-soft)]">
            {t("preorder.history.deposit")}{" "}
            <span className="font-mono text-[var(--color-or-pale)]">
              {Number(po.deposit_amount).toLocaleString(undefined, {
                minimumFractionDigits: 0,
                maximumFractionDigits: 2,
              })}{" "}
              {po.price_currency ?? ""}
            </span>
          </span>
        ) : null}
        {/* Delivery countdown — visible only when shipped + ETA both set.
         *  J-3 / J0 / J+2 (overdue tinted laque). Native `title` tooltip
         *  reveals the exact projected delivery date on hover/long-press. */}
        {(() => {
          const days = deliveryCountdown(po);
          if (days == null) return null;
          const date = deliveryDateLabel(po);
          return (
            <span
              title={date ? t("preorder.delivery.tooltip", { date }) : undefined}
              className={`font-mono uppercase tracking-[0.22em] cursor-help ${countdownTone(days)}`}
            >
              {formatCountdown(days, t)}
            </span>
          );
        })()}
      </div>

      {/* Slip timeline — only when there are previous date changes */}
      {history.data?.length ? (
        <div className="mt-6">
          <p className="micro-tight mb-3">{t("preorder.history.slips")}</p>
          <ol className="relative border-l border-[var(--color-or)]/25 ml-2 space-y-3 pl-5">
            {history.data.map((h) => (
              <li key={h.id} className="relative">
                <span
                  aria-hidden
                  className="absolute -left-[26px] top-1.5 w-2 h-2 bg-[var(--color-or)] rotate-45"
                />
                <p className="text-sm text-[var(--color-ivoire)]">
                  <span className="text-[var(--color-ivoire-soft)] line-through mr-2">
                    {fmtDate(h.previous_date)}
                  </span>
                  →{" "}
                  <span className="text-[var(--color-or-pale)]">
                    {fmtDate(h.new_date)}
                  </span>
                </p>
                <p className="micro-tight opacity-70 mt-0.5">
                  {new Date(h.noted_at).toLocaleDateString()}
                  {h.source ? <> · {h.source}</> : null}
                  {h.note ? <> · {h.note}</> : null}
                </p>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </section>
  );
}

function phaseFromStatus(status) {
  if (status === "received") return "received";
  if (status === "cancelled") return "cancelled";
  if (status === "released" || status === "shipped") return "imminent";
  return "preorder";
}

function statusPillClasses(phase) {
  const base =
    "inline-flex items-center gap-2 px-3 py-1 text-[10px] uppercase tracking-[0.22em] border whitespace-nowrap";
  switch (phase) {
    case "received":
      return `${base} border-[var(--color-or)]/40 bg-[var(--color-or)]/10 text-[var(--color-or-pale)]`;
    case "imminent":
      return `${base} border-[var(--color-or)] bg-[var(--color-or)]/15 text-[var(--color-or)]`;
    case "cancelled":
      return `${base} border-[var(--color-laque-bright)]/40 text-[var(--color-laque-bright)]`;
    default:
      return `${base} border-[var(--color-or-pale)]/40 text-[var(--color-or-pale)]`;
  }
}

function fmtDate(d) {
  if (!d) return "—";
  const parsed = new Date(d);
  if (Number.isNaN(parsed.getTime())) return d;
  return parsed.toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}


function DateCard({ label, value, highlight, slipNote }) {
  return (
    <div
      className={`p-4 border ${
        highlight
          ? "border-[var(--color-or)]/40 bg-[var(--color-or)]/5"
          : "border-[var(--color-or)]/15 bg-[var(--color-noir)]"
      }`}
    >
      <p className="micro-tight">{label}</p>
      <p className="display text-xl text-[var(--color-ivoire)] mt-2 leading-tight">
        {value}
      </p>
      {slipNote ? (
        <p className="micro-tight mt-1 text-[var(--color-or-pale)]/80">
          {slipNote}
        </p>
      ) : null}
    </div>
  );
}

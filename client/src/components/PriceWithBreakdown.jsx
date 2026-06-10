import { useEffect, useRef, useState } from "react";
import { useT } from "../i18n/index.jsx";

/**
 * Renders a total price with a tooltip-style popover detailing the
 * breakdown — deposit, item cost, shipping, and catalog MSRP delta.
 *
 * Interaction model (mobile-aware):
 *   - touch / click  → toggles the popover (sticky)
 *   - mouse-enter    → opens it
 *   - mouse-leave    → closes it (only when it wasn't opened by click)
 *   - Esc            → closes
 *   - click outside  → closes
 *
 * Always renders the total; the popover only appears when there's
 * something to break down — when the user paid shipping, when a deposit
 * was recorded, or when the catalog MSRP differs from what they paid.
 * The "ⓘ" affordance hint only appears when a breakdown exists.
 *
 * Deposit semantics (OrzGK / Tsuki Hobby style preorders): the deposit
 * is part of the figurine cost — paid upfront, deducted from the
 * balance before shipping. So `price` is the TOTAL figurine cost, and
 * the popover splits it into "DÉPÔT" (what was paid at preorder time)
 * and "FIGURINE" (the balance = price - deposit). The grand total
 * stays `price + shipping` regardless.
 *
 * Cancellation semantics: when `cancelled` is truthy, the figurine was
 * never received. The deposit (if any) is treated as a sunk cost and we
 * show "ACOMPTE PERDU (deposit - refund) EUR" in laque-red if the user
 * lost money, OR hide the deposit line entirely if it was fully
 * refunded. The figurine + balance lines are also suppressed in that
 * state — only the deposit-loss line matters.
 *
 * @param {object} props
 * @param {number|string|null|undefined} props.price       Total figurine cost (paid).
 * @param {number|string|null|undefined} props.shipping    Shipping cost.
 * @param {number|string|null|undefined} props.deposit     Upfront preorder deposit
 *        (part of `price`, not in addition to it).
 * @param {number|string|null|undefined} props.depositRefund
 *        Amount actually refunded after a cancellation. `null` = pending,
 *        `0` = full loss, between = partial, `>= deposit` = fully refunded.
 * @param {boolean}                       [props.cancelled]  When true, the
 *        breakdown switches to "ACOMPTE PERDU" mode (laque-red) instead
 *        of the regular price/shipping rows.
 * @param {string|null|undefined}         props.currency
 * @param {number|string|null|undefined} props.catalog     Catalog MSRP for reference.
 * @param {string|null|undefined}         props.catalogCurrency
 * @param {"sm"|"md"|"lg"}                [props.size]      Visual weight.
 * @param {string}                        [props.className]
 */
export default function PriceWithBreakdown({
  price,
  shipping,
  deposit,
  depositRefund,
  cancelled = false,
  currency,
  catalog,
  catalogCurrency,
  size = "md",
  className = "",
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [locked, setLocked] = useState(false);
  const ref = useRef(null);

  const itemNum = toNum(price);
  const shipNum = toNum(shipping);
  const depositNum = toNum(deposit);
  const refundNum = toNum(depositRefund);
  const catalogNum = toNum(catalog);

  const hasItem = itemNum != null;
  const hasShipping = shipNum != null && shipNum > 0;
  const hasDeposit = depositNum != null && depositNum > 0;
  const hasCatalog = catalogNum != null && catalogNum > 0;
  // The net loss on a cancellation = deposit - refund (clamped to ≥ 0;
  // a refund larger than the deposit is treated as "no loss"). NULL refund
  // means "no decision yet", which we still treat as a loss of the full
  // deposit for display — the user can correct that by entering a value.
  const lossNum = cancelled && hasDeposit
    ? Math.max(0, depositNum - (refundNum ?? 0))
    : 0;
  const hasLoss = cancelled && lossNum > 0;
  // Total paid: regular path = price + shipping (deposit is part of
  // price). Cancellation path = just the loss (no figurine received,
  // no shipping). When fully refunded, total = 0 → component renders
  // a plain "—".
  const total = cancelled
    ? lossNum
    : (itemNum ?? 0) + (shipNum ?? 0);
  // The figurine line displays the BALANCE — what was paid after the
  // deposit was deducted. When there's no deposit, balance == price.
  const balanceNum = hasItem && hasDeposit ? itemNum - depositNum : itemNum;
  // Delta only meaningful for received pieces — a cancelled preorder
  // never produced a "price paid" comparable to catalog MSRP.
  const delta =
    !cancelled && hasItem && hasCatalog ? deltaInfo(itemNum, catalogNum) : null;
  // Only show the breakdown popover if there's something meaningful to
  // break down — shipping line, deposit line, cancellation loss, OR a
  // catalog reference + delta.
  const hasBreakdown =
    hasShipping || hasDeposit || hasLoss || (hasCatalog && delta);

  // Close on click-outside and Esc — but only when the popover was opened.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e) => {
      if (!ref.current?.contains(e.target)) {
        setOpen(false);
        setLocked(false);
      }
    };
    const onKey = (e) => {
      if (e.key === "Escape") {
        setOpen(false);
        setLocked(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!hasItem && !hasShipping && !hasDeposit && !hasLoss) {
    return <span className={className}>—</span>;
  }

  const sizeClass =
    size === "lg"
      ? "text-2xl"
      : size === "sm"
        ? "text-sm"
        : "text-base";

  // When there's nothing to break down, render a plain non-interactive span.
  if (!hasBreakdown) {
    return (
      <span className={`${sizeClass} ${className}`}>
        {fmtMoney(total)} {currency ?? ""}
      </span>
    );
  }

  return (
    <span ref={ref} className={`relative inline-block ${className}`}>
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => {
          // Click toggles a sticky-open state — mouse leave can't close it
          // until the user clicks somewhere else.
          if (locked && open) {
            setOpen(false);
            setLocked(false);
          } else {
            setOpen(true);
            setLocked(true);
          }
        }}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => {
          if (!locked) setOpen(false);
        }}
        className={`inline-flex items-baseline gap-1.5 ${sizeClass} hover:text-[var(--color-or-pale)] transition-colors`}
      >
        <span>
          {fmtMoney(total)} {currency ?? ""}
        </span>
        <span
          aria-hidden
          className={`text-[10px] transition-opacity ${
            open ? "opacity-90" : "opacity-50"
          }`}
        >
          ⓘ
        </span>
      </button>

      {open ? (
        <div
          role="dialog"
          className="price-breakdown-popup absolute right-0 top-full mt-3 z-30 w-[min(20rem,calc(100vw-1.5rem))] p-3.5 border bg-[var(--color-noir-soft)]"
          style={{
            // Stronger gold border than the previous /40 so the popup
            // actually separates from the dl card behind it.
            borderColor: "oklch(0.78 0.10 80 / 0.7)",
            // Two-layer shadow: a tight outer halo to lift the card off
            // the page + a soft drop for depth. The inset top-edge gold
            // glint is what makes the surface read as a polished plaque.
            boxShadow:
              "0 0 0 1px oklch(0.10 0.004 50 / 0.6), 0 18px 40px -12px rgba(0,0,0,0.95), 0 6px 14px -6px rgba(0,0,0,0.7), inset 0 1px 0 oklch(0.92 0.08 80 / 0.18)",
          }}
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={() => {
            if (!locked) setOpen(false);
          }}
        >
          {/* Upward-pointing arrow tab — anchors the popup to its trigger
              visually. Two stacked triangles: the outer one matches the gold
              border, the inner one masks it with the popup's own background
              so the line reads as continuous with the card edge. Hidden when
              the popup detaches as a bottom sheet on narrow viewports. */}
          <span
            aria-hidden
            className="price-breakdown-arrow absolute -top-[7px] right-4 w-[12px] h-[7px]"
            style={{
              background: "var(--color-noir-soft)",
              clipPath: "polygon(50% 0, 0 100%, 100% 100%)",
              boxShadow: "0 -1px 0 oklch(0.78 0.10 80 / 0.7)",
            }}
          />
          <p className="text-[10px] uppercase tracking-[0.22em] text-[var(--color-or-pale)]/70 mb-2.5">
            {t("price.breakdown.title")}
          </p>
          <dl className="space-y-1.5">
            {/* Cancellation path — replaces deposit / figurine / shipping
                with a single laque-red "ACOMPTE PERDU" row. */}
            {cancelled ? (
              hasLoss ? (
                <BreakdownRow
                  label={t("price.breakdown.deposit_lost")}
                  value={`${fmtMoney(lossNum)} ${currency ?? ""}`}
                  loss
                />
              ) : null
            ) : (
              <>
                {/* Deposit appears ABOVE the figurine line — it represents
                    the upfront payment, with the figurine line below showing
                    what's left to settle before shipping. */}
                {hasDeposit ? (
                  <BreakdownRow
                    label={t("price.breakdown.deposit")}
                    value={`${fmtMoney(depositNum)} ${currency ?? ""}`}
                  />
                ) : null}
                {hasItem ? (
                  <BreakdownRow
                    label={t("price.breakdown.item")}
                    value={`${fmtMoney(balanceNum)} ${currency ?? ""}`}
                  />
                ) : null}
                {hasShipping ? (
                  <BreakdownRow
                    label={t("price.breakdown.shipping")}
                    value={`${fmtMoney(shipNum)} ${currency ?? ""}`}
                  />
                ) : null}
              </>
            )}
            <BreakdownRow
              label={t("price.breakdown.total")}
              value={`${fmtMoney(total)} ${currency ?? ""}`}
              strong
            />
            {hasCatalog ? (
              <BreakdownRow
                label={t("price.breakdown.catalog")}
                value={`${fmtMoney(catalogNum)} ${catalogCurrency ?? currency ?? ""}`}
                dim
              />
            ) : null}
          </dl>
          {delta ? (
            <p
              className={`mt-2.5 pt-2 border-t border-[var(--color-or)]/15 text-[10px] uppercase tracking-[0.22em] ${
                delta.direction === "above"
                  ? "text-[var(--color-laque-bright)]"
                  : "text-[var(--color-or)]"
              }`}
            >
              {delta.direction === "above"
                ? t("price.breakdown.above_catalog", { delta: delta.label })
                : t("price.breakdown.below_catalog", { delta: delta.label })}
            </p>
          ) : null}
        </div>
      ) : null}
    </span>
  );
}

function BreakdownRow({ label, value, strong, dim, loss }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt
        className={`text-[10px] uppercase tracking-[0.22em] ${
          loss
            ? "text-[var(--color-laque-bright)]"
            : dim
              ? "text-[var(--color-ivoire-soft)]/55"
              : "text-[var(--color-or-pale)]/80"
        }`}
      >
        {label}
      </dt>
      <dd
        className={`font-mono text-xs tracking-wider ${
          loss
            ? "text-[var(--color-laque-bright)]"
            : strong
              ? "text-[var(--color-or)]"
              : dim
                ? "text-[var(--color-ivoire-soft)]/70"
                : "text-[var(--color-ivoire)]"
        }`}
      >
        {value}
      </dd>
    </div>
  );
}

function toNum(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function fmtMoney(n) {
  if (n == null || !Number.isFinite(n)) return "—";
  // Follow the app's chosen language (i18n sets <html lang>), not the browser
  // locale, so an EN-browser / FR-app user sees FR grouping (1 234,5), not US.
  const locale =
    (typeof document !== "undefined" && document.documentElement.lang) || undefined;
  return n.toLocaleString(locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function deltaInfo(paid, msrp) {
  if (!Number.isFinite(paid) || !Number.isFinite(msrp) || msrp === 0) return null;
  if (Math.abs(paid - msrp) < 0.01) return null;
  const diff = paid - msrp;
  const pct = ((diff / msrp) * 100).toFixed(0);
  return {
    direction: diff > 0 ? "above" : "below",
    label: `${diff > 0 ? "+" : ""}${pct}%`,
  };
}

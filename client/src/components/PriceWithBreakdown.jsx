import { useEffect, useRef, useState } from "react";
import { useT } from "../i18n/index.jsx";

/**
 * Renders a total price with a tooltip-style popover detailing the
 * breakdown — item cost, shipping, and catalog MSRP delta.
 *
 * Interaction model (mobile-aware):
 *   - touch / click  → toggles the popover (sticky)
 *   - mouse-enter    → opens it
 *   - mouse-leave    → closes it (only when it wasn't opened by click)
 *   - Esc            → closes
 *   - click outside  → closes
 *
 * Always renders the total; the popover only appears when there's
 * something to break down — when the user paid shipping, or the catalog
 * MSRP differs from what they paid. The "ⓘ" affordance hint only appears
 * when a breakdown exists.
 *
 * @param {object} props
 * @param {number|string|null|undefined} props.price       Item cost (what they paid).
 * @param {number|string|null|undefined} props.shipping    Shipping cost.
 * @param {string|null|undefined}         props.currency
 * @param {number|string|null|undefined} props.catalog     Catalog MSRP for reference.
 * @param {string|null|undefined}         props.catalogCurrency
 * @param {"sm"|"md"|"lg"}                [props.size]      Visual weight.
 * @param {string}                        [props.className]
 */
export default function PriceWithBreakdown({
  price,
  shipping,
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
  const catalogNum = toNum(catalog);

  const hasItem = itemNum != null;
  const hasShipping = shipNum != null && shipNum > 0;
  const hasCatalog = catalogNum != null && catalogNum > 0;
  const total = (itemNum ?? 0) + (shipNum ?? 0);
  // Delta compares the figure's price alone (item cost) against the
  // catalog MSRP. Including shipping here would always tilt the result
  // upward, hiding actual promo savings — shipping is a carrier line item,
  // not a markup on the figure itself.
  const delta = hasItem && hasCatalog ? deltaInfo(itemNum, catalogNum) : null;
  // Only show the breakdown popover if there's something meaningful to
  // break down — shipping line, OR a catalog reference + delta.
  const hasBreakdown = hasShipping || (hasCatalog && delta);

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

  if (!hasItem && !hasShipping) {
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
          className="absolute right-0 top-full mt-2 z-30 min-w-[16rem] max-w-[20rem] p-3.5 border border-[var(--color-or)]/40 bg-[var(--color-noir-soft)]"
          style={{
            boxShadow:
              "0 25px 50px -20px rgba(0,0,0,0.85), inset 0 1px 0 oklch(0.92 0.08 80 / 0.12)",
          }}
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={() => {
            if (!locked) setOpen(false);
          }}
        >
          <p className="text-[10px] uppercase tracking-[0.22em] text-[var(--color-or-pale)]/70 mb-2.5">
            {t("price.breakdown.title")}
          </p>
          <dl className="space-y-1.5">
            {hasItem ? (
              <BreakdownRow
                label={t("price.breakdown.item")}
                value={`${fmtMoney(itemNum)} ${currency ?? ""}`}
              />
            ) : null}
            {hasShipping ? (
              <BreakdownRow
                label={t("price.breakdown.shipping")}
                value={`${fmtMoney(shipNum)} ${currency ?? ""}`}
              />
            ) : null}
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

function BreakdownRow({ label, value, strong, dim }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt
        className={`text-[10px] uppercase tracking-[0.22em] ${
          dim ? "text-[var(--color-ivoire-soft)]/55" : "text-[var(--color-or-pale)]/80"
        }`}
      >
        {label}
      </dt>
      <dd
        className={`font-mono text-xs ${
          strong
            ? "text-[var(--color-or)] tracking-wider"
            : dim
              ? "text-[var(--color-ivoire-soft)]/70 tracking-wider"
              : "text-[var(--color-ivoire)] tracking-wider"
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
  return n.toLocaleString(undefined, {
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

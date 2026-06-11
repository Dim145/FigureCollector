import { useDisplayCurrency } from "./DisplayCurrencyProvider.jsx";
import { fmtMoney, toDisplay } from "../lib/money.js";

function docLocale() {
  if (typeof document !== "undefined" && document.documentElement.lang) {
    return document.documentElement.lang;
  }
  return undefined;
}

/**
 * The one inline price element. Renders an amount in its own currency, or —
 * when display conversion is active and a rate exists — converts it to the
 * user's display currency and marks it approximate: a hushed gold "≈" prefix,
 * the figure in the page's own weight, the ORIGINAL amount on hover. Native
 * (unconverted) amounts render exactly as before, with no marker.
 *
 * Props:
 *   amount, currency — the stored amount + its ISO currency.
 *   round            — round to a whole unit before formatting (big totals).
 *   className        — passed through to the wrapping <span>.
 *   title            — tooltip override (defaults to the original amount).
 *   approx           — override for a PRE-CONVERTED total (already summed into
 *                      the display currency, see sumInDisplay): pass the
 *                      `converted` flag — true forces the ≈ marker (there's no
 *                      single original to hover), false renders it plain.
 */
export default function Money({
  amount,
  currency,
  round = false,
  className = "",
  title,
  approx,
}) {
  const dc = useDisplayCurrency();
  const locale = docLocale();

  if (amount == null || !Number.isFinite(Number(amount))) {
    return <span className={className}>—</span>;
  }
  const n = Number(amount);

  // Pre-converted total path: the caller already summed into the display
  // currency, so we only decide whether to flag it approximate.
  if (approx !== undefined) {
    const v = round ? Math.round(n) : n;
    const text = fmtMoney(v, currency, locale);
    if (!approx) return <span className={className}>{text}</span>;
    return (
      <span className={`fc-money-approx ${className}`} title={title}>
        <span aria-hidden className="fc-money-approx-mark">
          ≈&nbsp;
        </span>
        {text}
      </span>
    );
  }

  let shown = { amount: n, currency, converted: false };
  if (dc.active && dc.ready) {
    const c = toDisplay(dc.rates, dc.display, n, currency);
    if (c && c.converted) shown = c;
  }
  const v = round ? Math.round(shown.amount) : shown.amount;
  const text = fmtMoney(v, shown.currency, locale);

  if (!shown.converted) {
    return <span className={className}>{text}</span>;
  }
  return (
    <span
      className={`fc-money-approx ${className}`}
      title={title ?? fmtMoney(n, currency, locale)}
    >
      <span aria-hidden className="fc-money-approx-mark">
        ≈&nbsp;
      </span>
      {text}
    </span>
  );
}

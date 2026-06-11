// Shared money helpers.
//
// Amounts are STORED in their own ISO-4217 currency and never mutated. For
// DISPLAY, a single chosen currency (the user's `preferred_currency`) is the
// target: `toDisplay` / `sumInDisplay` convert through an EUR-anchored rate
// table (ECB, see external::fx) at the current rate. Conversion is presentation
// only — the original amount is always preserved and shown on hover.
//
// (Phase 1: cost is converted at today's rate like value. Phase 2 will freeze
// the rate captured at purchase time for cost basis — see the pricing-refonte
// memory.)

/** Currencies offered for display + input. One source of truth for the SPA. */
export const DISPLAY_CURRENCIES = ["EUR", "USD", "GBP", "JPY", "CHF", "CAD"];

// Per-currency minor-unit count, resolved once via Intl (JPY→0, EUR→2, BHD→3).
// Caching matters: `t`/render paths call fmtMoney a lot.
const FRACTION_CACHE = {};
function maxFractionDigits(cur) {
  if (cur in FRACTION_CACHE) return FRACTION_CACHE[cur];
  let d = 2;
  try {
    d = new Intl.NumberFormat(undefined, { style: "currency", currency: cur })
      .resolvedOptions().maximumFractionDigits;
  } catch {
    d = 2;
  }
  FRACTION_CACHE[cur] = d;
  return d;
}

/** Format an amount in a currency. `minimumFractionDigits: 0` drops a trailing
 *  ".00" so "3 248 €" reads clean, while the max follows the currency's real
 *  minor units — so a yen amount is never shown with decimals (the old code
 *  forced 2, mis-rendering JPY). Falls back gracefully on an unknown code. */
export function fmtMoney(amount, currency, locale) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return "—";
  const cur = (currency || "EUR").toUpperCase();
  try {
    return n.toLocaleString(locale || undefined, {
      style: "currency",
      currency: cur,
      minimumFractionDigits: 0,
      maximumFractionDigits: maxFractionDigits(cur),
    });
  } catch {
    return `${n.toLocaleString(locale || undefined)} ${cur}`;
  }
}

// =============================================================================
// Display-currency conversion (EUR-anchored, current rate)
// =============================================================================

/** Units of `cur` per 1 EUR (frankfurter's convention; EUR itself = 1), or
 *  null when the rate table doesn't cover it. */
export function rateToEur(rates, cur) {
  const c = (cur || "").toUpperCase();
  if (c === "EUR") return 1;
  const r = rates?.[c];
  return r != null && Number(r) > 0 ? Number(r) : null;
}

/** Convert `amount` from `currency` to `display`, via EUR. Returns
 *  `{ amount, currency, converted }`. `converted:false` (amount untouched, in
 *  its own currency) when there's no display target, it's already the display
 *  currency, or a needed rate is missing (`unconvertible:true` flags the last
 *  case so callers can mark a total incomplete). Never throws. */
export function toDisplay(rates, display, amount, currency) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return null;
  const from = (currency || "").toUpperCase();
  const to = (display || "").toUpperCase();
  if (!to || from === to) {
    return { amount: n, currency: from || to || null, converted: false };
  }
  const rf = rateToEur(rates, from);
  const rt = rateToEur(rates, to);
  if (rf == null || rt == null) {
    return { amount: n, currency: from, converted: false, unconvertible: true };
  }
  return { amount: (n / rf) * rt, currency: to, converted: true };
}

/** Sum per-currency `buckets` into `display`. Returns `{ amount, currency,
 *  converted, partial }` — `partial:true` when a bucket couldn't convert and
 *  was left out, so the caller can flag the total as incomplete. */
export function sumInDisplay(rates, display, buckets, field, currencyKey = "currency") {
  let amount = 0;
  let converted = false;
  let partial = false;
  for (const b of buckets ?? []) {
    const r = toDisplay(rates, display, b[field], b[currencyKey]);
    if (!r) continue;
    if (r.unconvertible) {
      partial = true;
      continue;
    }
    if (r.converted) converted = true;
    amount += r.amount;
  }
  return { amount, currency: display, converted, partial };
}

// =============================================================================
// Owned-item value resolution (unchanged semantics)
// =============================================================================

/** Effective current value of an owned item, by priority: the manual
 *  `value_amount`, else the auto-fetched provider/market price (the price
 *  cron), else the figure's catalog MSRP. Returns
 *  `{ amount, currency, isManual, source }` (source: "manual" | "auto" |
 *  "msrp") or `null` when none is known. */
export function effectiveValue(item) {
  if (item?.value_amount != null) {
    const amount = Number(item.value_amount);
    if (!Number.isFinite(amount)) return null;
    return {
      amount,
      currency: item.value_currency || item.price_currency || null,
      isManual: true,
      source: "manual",
    };
  }
  // Auto-fetched provider/market price — sits between the manual value and the
  // MSRP fallback (an empty/absent value means the cron hasn't priced it).
  if (item?.provider_price_amount != null) {
    const amount = Number(item.provider_price_amount);
    if (Number.isFinite(amount)) {
      return {
        amount,
        currency: item.provider_price_currency || item.msrp_currency || null,
        isManual: false,
        source: "auto",
      };
    }
  }
  if (item?.msrp_amount != null) {
    const amount = Number(item.msrp_amount);
    if (!Number.isFinite(amount)) return null;
    return {
      amount,
      currency: item.msrp_currency || null,
      isManual: false,
      source: "msrp",
    };
  }
  return null;
}

/** Total amount paid for an item (figure price + shipping), in
 *  `price_currency`. Returns `null` when no price was recorded. */
export function paidTotal(item) {
  if (item?.price_amount == null) return null;
  const amount = Number(item.price_amount) + Number(item.shipping_amount || 0);
  if (!Number.isFinite(amount)) return null;
  return {
    amount,
    currency: item.price_currency || null,
  };
}

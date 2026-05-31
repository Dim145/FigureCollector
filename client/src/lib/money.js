// Shared money helpers for the collection-value ("cote") surfaces.
//
// The app has no FX layer — amounts are kept in their own ISO 4217 currency
// and aggregated per-currency (see domain::stats). These helpers format a
// single amount and resolve an owned item's *effective* value (manual value,
// else the figure's catalog MSRP).

/** Format an amount in a currency. Drops the decimals for whole numbers so
 *  "3 248 €" reads cleaner than "3 248,00 €". Falls back gracefully if the
 *  currency code is unknown to Intl. */
export function fmtMoney(amount, currency, locale) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return "—";
  const cur = (currency || "EUR").toUpperCase();
  try {
    return n.toLocaleString(locale || undefined, {
      style: "currency",
      currency: cur,
      minimumFractionDigits: 0,
      maximumFractionDigits: Number.isInteger(n) ? 0 : 2,
    });
  } catch {
    return `${n.toLocaleString(locale || undefined)} ${cur}`;
  }
}

/** Effective current value of an owned item: the manual `value_amount` when
 *  set, otherwise the figure's catalog MSRP. Returns
 *  `{ amount, currency, isManual }` or `null` when neither is known. */
export function effectiveValue(item) {
  if (item?.value_amount != null) {
    const amount = Number(item.value_amount);
    if (!Number.isFinite(amount)) return null;
    return {
      amount,
      currency: item.value_currency || item.price_currency || null,
      isManual: true,
    };
  }
  if (item?.msrp_amount != null) {
    const amount = Number(item.msrp_amount);
    if (!Number.isFinite(amount)) return null;
    return {
      amount,
      currency: item.msrp_currency || null,
      isManual: false,
    };
  }
  return null;
}

/** Optional display-currency conversion (display-only — see useFx + external::fx).
 *  `fx` is the shape from useFx(): `{ convert, display, rates, overrides }`.
 *  Returns the "1 `from` = X display" multiplier, or null when conversion is off
 *  or the rate is unknown. A manual override wins; else `1 / rates[from]` (the
 *  proxy gives display-per-`from` when base = display). */
export function fxMultiplier(fx, from) {
  if (!fx?.convert || !fx.display || !from) return null;
  const cur = String(from).toUpperCase();
  if (cur === fx.display) return 1;
  const ov = fx.overrides?.[cur];
  if (ov != null && Number.isFinite(Number(ov)) && Number(ov) > 0) return Number(ov);
  const r = fx.rates?.[cur];
  return r != null && Number(r) > 0 ? 1 / Number(r) : null;
}

/** Convert `amount` (in `from`) into the display currency, or null when the
 *  conversion isn't possible. Returns null for a non-finite `amount` too, so a
 *  garbage value can't poison a running sum with NaN. */
export function convertAmount(amount, from, fx) {
  const m = fxMultiplier(fx, from);
  if (m == null) return null;
  const n = Number(amount);
  return Number.isFinite(n) ? n * m : null;
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

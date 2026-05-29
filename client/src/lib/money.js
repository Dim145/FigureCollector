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
    return {
      amount: Number(item.value_amount),
      currency: item.value_currency || item.price_currency || null,
      isManual: true,
    };
  }
  if (item?.msrp_amount != null) {
    return {
      amount: Number(item.msrp_amount),
      currency: item.msrp_currency || null,
      isManual: false,
    };
  }
  return null;
}

/** Total amount paid for an item (figure price + shipping), in
 *  `price_currency`. Returns `null` when no price was recorded. */
export function paidTotal(item) {
  if (item?.price_amount == null) return null;
  return {
    amount: Number(item.price_amount) + Number(item.shipping_amount || 0),
    currency: item.price_currency || null,
  };
}

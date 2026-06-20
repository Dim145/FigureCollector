import { rateToEur } from "../../lib/money.js";

/** Cover URL for a wishlist row (catalogue cover photo, else the figure image). */
export const coverFor = (it) =>
  it.catalog_cover_photo_id
    ? `/api/figure-photos/${it.catalog_cover_photo_id}`
    : it.figure_image || null;

/**
 * A piece's market price: the cron's latest relevé (provider price) when known,
 * else the catalogue MSRP. Returned as `{ amount, currency }` or null.
 */
export const marketPrice = (it) => {
  if (it.provider_price_amount != null) {
    return {
      amount: Number(it.provider_price_amount),
      currency: it.provider_price_currency || it.msrp_currency || null,
    };
  }
  if (it.msrp_amount != null) {
    return { amount: Number(it.msrp_amount), currency: it.msrp_currency || null };
  }
  return null;
};

/**
 * Whether the market price meets the user's cible — compared ACROSS currencies
 * (same currency → direct; otherwise both convert to EUR via the display rate
 * table, mirroring the server's wishlist alert). Falls back to same-currency
 * only when a rate (or the table) is missing.
 */
export const dealIsMet = (it, prefCurrency, rates) => {
  const m = marketPrice(it);
  if (it.max_price_amount == null || m == null) return false;
  const target = Number(it.max_price_amount);
  const targetCur = it.max_price_currency || prefCurrency;
  const priceCur = m.currency || targetCur;
  if (!targetCur || !priceCur || targetCur === priceCur) {
    return m.amount <= target;
  }
  const rt = rateToEur(rates, targetCur);
  const rp = rateToEur(rates, priceCur);
  if (rt == null || rp == null) return false;
  return m.amount / rp <= target / rt;
};

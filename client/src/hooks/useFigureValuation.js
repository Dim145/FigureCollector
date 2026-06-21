import { effectiveValue, figurePaid } from "../lib/money.js";

/**
 * Single source of truth for an owned figure's valuation, derived from the
 * figure + its owned record. Both the sticky rail's glance (OwnerGlance) and the
 * #valeur section consume this, so the gain rules (which fields feed the
 * effective value, the same-currency guard, shipping kept out of the gain basis)
 * live in ONE place and can't drift between the two surfaces.
 *
 * Pure derivation — no hooks, no React. Safe to call during render.
 *
 *   value    {amount,currency,isManual,source} | null — current cote
 *            (manual value → auto/market price → catalog MSRP)
 *   paid     {amount,currency} | null — purchase PRICE only (shipping is a sunk
 *            cost excluded from the plus-value, matching the Cote page)
 *   gain     number | null — value − paid, only when both share a currency
 *            and a non-zero price exists (no FX layer)
 *   gainPct  number | null — rounded % of `paid`
 *   up       boolean — gain ≥ 0 (meaningful only when gain != null)
 *   currency string | null — the display currency for the gain (value's, else
 *            paid's)
 *
 * @param {object} f      The figure (carries MSRP fallback fields).
 * @param {object} owned  The owned record (value/price/provider fields).
 */
export function deriveValuation(f, owned) {
  const value = owned
    ? effectiveValue({
        value_amount: owned.value_amount,
        value_currency: owned.value_currency,
        price_currency: owned.price_currency,
        provider_price_amount: owned.provider_price_amount,
        provider_price_currency: owned.provider_price_currency,
        msrp_amount: f?.msrp_amount,
        msrp_currency: f?.msrp_currency,
      })
    : null;
  const paid = owned ? figurePaid(owned) : null;
  // Only a gain when both sides are in the SAME currency (no FX conversion here).
  const sameCurrency = !!(paid && value && (paid.currency || "") === (value.currency || ""));
  const gain = sameCurrency && paid.amount > 0 ? value.amount - paid.amount : null;
  const gainPct = gain != null && paid.amount > 0 ? Math.round((gain / paid.amount) * 100) : null;
  const up = gain != null && gain >= 0;
  const currency = value?.currency || paid?.currency || null;
  return { value, paid, gain, gainPct, up, currency };
}

/** Hook alias — same pure derivation, named for call sites that read like a
 *  hook. Stateless, so the bare function and this are interchangeable. */
export function useFigureValuation(f, owned) {
  return deriveValuation(f, owned);
}

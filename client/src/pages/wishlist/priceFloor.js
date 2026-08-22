/**
 * "Is this actually a good moment, or has it been cheaper?"
 *
 * A wishlist row only ever showed the latest observed price and a boolean
 * "under your target" — which cannot tell a genuine dip from a listing that has
 * always sat at that number. These helpers read the price history the cron has
 * been recording all along (for wished figures too, not just owned ones) and
 * turn it into the two facts that decide a purchase: how far today sits above
 * the cheapest ever seen, and how long the price has held.
 */

/** Milliseconds in a day, for the "stable since" read. */
const DAY = 86_400_000;

/**
 * Floor / ceiling / current, plus the distance above the floor.
 *
 * Points are compared **within a single currency** — the history carries its
 * own per-point currency and a JPY relevé must never be min()'d against a EUR
 * one. We keep the currency of the most recent point and drop the rest, which
 * is what the shop is actually charging today.
 *
 * Returns `null` when there aren't at least two comparable points — one relevé
 * is a price, not a history, and drawing a "floor" from it would be a lie.
 */
export function floorStats(series, now = Date.now()) {
  if (!series || series.length < 2) return null;
  const currency = series[series.length - 1].currency ?? null;
  const same = series.filter((p) => (p.currency ?? null) === currency);
  if (same.length < 2) return null;

  const last = same[same.length - 1];
  let floor = same[0].v;
  let ceiling = same[0].v;
  for (const p of same) {
    if (p.v < floor) floor = p.v;
    if (p.v > ceiling) ceiling = p.v;
  }
  const aboveFloorPct = floor > 0 ? ((last.v - floor) / floor) * 100 : 0;
  return {
    currency,
    floor,
    ceiling,
    current: last.v,
    aboveFloorPct,
    /** True when today's price IS the cheapest we have ever recorded. */
    atFloor: last.v <= floor + 1e-9,
    /** Days since the price last moved — a long plateau means "no rush". */
    stableDays: Math.max(0, Math.floor((now - last.t) / DAY)),
    points: same,
  };
}

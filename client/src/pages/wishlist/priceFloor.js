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
 * The cron stores price CHANGES only, so a single point is not a single
 * observation: a shop that has charged the same price for two months has
 * exactly one row, re-confirmed on every sweep since. That is a flat history
 * (`flat`), not a missing one.
 *
 * What the history vouches for ends at `fetchedAt` — the sweep's last
 * successful read, bumped whether the price moved or not — not at `now`: a
 * listing that stopped resolving would otherwise sit at its last price looking
 * stabler every day. So the plateau is counted up to that read, and once the
 * server calls the price `stale` (no read in PRICE_FRESH_DAYS) the reading is
 * "lost N days ago", not "stable". A lone point the sweep hasn't re-read a day
 * later is still just a price — `null` then, as for an empty series.
 *
 * `fetchedAt` (ms) and `stale` come from the wishlist row; without a read time
 * the plateau runs to `now`.
 */
export function floorStats(series, { now = Date.now(), fetchedAt = null, stale = false } = {}) {
  if (!series?.length) return null;
  const currency = series[series.length - 1].currency ?? null;
  const same = series.filter((p) => (p.currency ?? null) === currency);

  const last = same[same.length - 1];
  // The last moment the price is known to have held.
  const seenAt = Number.isFinite(fetchedAt) ? Math.max(last.t, Math.min(now, fetchedAt)) : now;
  if (same.length < 2 && !stale && seenAt - last.t < DAY) return null;
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
    /** Never moved — "at its floor" would be technically true and misleading. */
    flat: ceiling - floor <= 1e-9,
    /** Days the price held, from its last move to the sweep's last read —
     *  a long plateau means "no rush". */
    stableDays: Math.max(0, Math.floor((seenAt - last.t) / DAY)),
    /** The sweep lost the listing: `current` is the last price seen, not today's. */
    stale,
    /** Days since the sweep last read the price at all. */
    seenDaysAgo: Math.max(0, Math.floor((now - seenAt) / DAY)),
    points: same,
  };
}

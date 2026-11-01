/** Range chips for the evolution chart (days of look-back; "all" = full history). */
export const RANGE_DAYS = { "3m": 91, "6m": 183, "1y": 365 };

const DAY = 86_400_000;

/**
 * The server's PRICE_FRESH_DAYS (`server/src/domain/stats.rs`): how long the
 * sweep's last read keeps a shop price counting as market value. The server
 * decides WHICH prices are stale (`provider_price_stale`); this only places the
 * moment one stopped counting on the curve.
 */
const PRICE_FRESH_DAYS = 30;

/**
 * Collection evolution — "what the headline figure would have read at date T",
 * reconstructed per the cote chain (manual > market > MSRP) in one currency.
 *
 * Manual values and MSRPs aren't historized, so they contribute constants;
 * a market price contributes its step series (MSRP fallback before the piece's
 * first relevé). A market price the sweep has since lost stops counting
 * PRICE_FRESH_DAYS after its last read — exactly when the headline stopped
 * counting it — so from there the piece is worth its MSRP, and that drop is a
 * point of the curve. Without it the curve would hold a lost listing's last
 * price for ever and end above the headline.
 *
 * `items` are owned rows, `historyByFigure` maps figure_id → sorted chart points
 * (`toSeries`). Returns `[{ t, v, currency }]`, or null when there isn't enough
 * history to draw a curve.
 */
export function collectionCurve(items, historyByFigure, currency, range = "all") {
  if (!currency || !items?.length || !historyByFigure?.size) return null;
  const eq = (c) => (c || "").toUpperCase() === currency.toUpperCase();
  let constant = 0;
  const stepped = [];
  for (const o of items) {
    if (o.value_amount != null) {
      if (eq(o.value_currency || o.price_currency)) constant += Number(o.value_amount) || 0;
      continue;
    }
    const series = (historyByFigure.get(o.figure_id) ?? []).filter((p) => eq(p.currency));
    const msrp = o.msrp_amount != null && eq(o.msrp_currency) ? Number(o.msrp_amount) : null;
    const read = Date.parse(o.provider_price_fetched_at);
    const lostAt =
      o.provider_price_stale && Number.isFinite(read) ? read + PRICE_FRESH_DAYS * DAY : null;
    if (series.length) stepped.push({ series, msrp, lostAt });
    else if (msrp != null) constant += msrp;
  }
  if (!stepped.length) return null;
  // Ranges are anchored on the LAST event (no clock during render): the latest
  // relevé, or the moment a lost price stopped counting. The chart's right edge
  // sits there, and the step visually extends it as "holds today".
  let endT = 0;
  for (const s of stepped) {
    for (const p of s.series) if (p.t > endT) endT = p.t;
    if (s.lostAt != null && s.lostAt > endT) endT = s.lostAt;
  }
  if (!endT) return null;
  const cutoff = range === "all" ? 0 : endT - RANGE_DAYS[range] * DAY;
  const changeTs = new Set();
  for (const s of stepped) {
    for (const p of s.series) if (p.t >= cutoff) changeTs.add(p.t);
    if (s.lostAt != null && s.lostAt >= cutoff) changeTs.add(s.lostAt);
  }
  const sorted = [...changeTs].sort((a, b) => a - b);
  if (!sorted.length) return null;
  const start = cutoff > 0 ? cutoff : sorted[0];
  const ts = [...new Set([start, ...sorted.filter((x) => x > start)])].sort((a, b) => a - b);
  if (ts.length < 2) return null;
  const valAt = (T) => {
    let total = constant;
    for (const s of stepped) {
      let v = null;
      if (s.lostAt == null || T < s.lostAt) {
        for (const p of s.series) {
          if (p.t <= T) v = p.v;
          else break;
        }
      }
      if (v == null) v = s.msrp;
      if (v != null) total += v;
    }
    return total;
  };
  return ts.map((T) => ({ t: T, v: valAt(T), currency }));
}

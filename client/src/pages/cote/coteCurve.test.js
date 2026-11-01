import { describe, expect, it } from "vitest";
import { collectionCurve } from "./coteCurve.js";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 1);
const at = (daysAgo) => NOW - daysAgo * DAY;
const iso = (daysAgo) => new Date(at(daysAgo)).toISOString();
const history = (entries) =>
  new Map(
    Object.entries(entries).map(([id, pairs]) => [
      id,
      pairs.map(([daysAgo, v]) => ({ t: at(daysAgo), v, currency: "EUR" })),
    ]),
  );
const piece = (id, over = {}) => ({
  figure_id: id,
  value_amount: null,
  msrp_amount: null,
  msrp_currency: "EUR",
  provider_price_fetched_at: null,
  provider_price_stale: false,
  ...over,
});
// A shop price the sweep last read `daysAgo` days ago and has since lost.
const lost = (daysAgo) => ({ provider_price_fetched_at: iso(daysAgo), provider_price_stale: true });
const values = (curve) => curve.map((p) => p.v);

describe("collectionCurve", () => {
  it("holds a fresh market price to the right edge, beside the constants", () => {
    const curve = collectionCurve(
      [
        piece("a", { msrp_amount: 150 }),
        piece("b", { value_amount: 50, value_currency: "EUR" }),
        piece("c", { msrp_amount: 80 }),
      ],
      history({ a: [[90, 100], [30, 120]] }),
      "EUR",
    );
    expect(values(curve)).toEqual([230, 250]);
    expect(curve.at(-1).t).toBe(at(30));
  });

  it("drops a lost price to its MSRP when the headline stopped counting it", () => {
    // `a` was last read 80 days ago, so it stopped counting 50 days ago.
    const curve = collectionCurve(
      [piece("a", { msrp_amount: 150, ...lost(80) }), piece("b", { msrp_amount: 180 })],
      history({ a: [[120, 100], [100, 300]], b: [[90, 200], [10, 210]] }),
      "EUR",
    );
    expect(curve.map((p) => p.t)).toEqual([at(120), at(100), at(90), at(50), at(10)]);
    expect(values(curve)).toEqual([280, 480, 500, 350, 360]);
    // The right edge is what the headline says today: a's MSRP + b's price.
    expect(curve.at(-1).v).toBe(150 + 210);
  });

  it("extends the curve to the moment a lost price stopped counting", () => {
    const curve = collectionCurve(
      [piece("a", { msrp_amount: 150, ...lost(100) })],
      history({ a: [[200, 100], [150, 300]] }),
      "EUR",
    );
    expect(curve.at(-1)).toEqual({ t: at(70), v: 150, currency: "EUR" });
  });

  it("drops a lost price with no MSRP in the currency out of the total", () => {
    const curve = collectionCurve(
      [
        piece("a", { msrp_amount: 30000, msrp_currency: "JPY", ...lost(100) }),
        piece("b", { value_amount: 50, value_currency: "EUR" }),
      ],
      history({ a: [[200, 100], [150, 300]] }),
      "EUR",
    );
    expect(values(curve)).toEqual([150, 350, 50]);
  });

  it("shows the MSRP throughout a range that starts after the drop", () => {
    const curve = collectionCurve(
      [piece("a", { msrp_amount: 150, ...lost(200) }), piece("b", { msrp_amount: 180 })],
      history({ a: [[400, 100], [300, 300]], b: [[100, 200], [20, 210]] }),
      "EUR",
      "3m",
    );
    expect(values(curve)).toEqual([330, 350, 360]);
  });

  it("needs two points to draw anything", () => {
    expect(collectionCurve([piece("a")], history({ a: [[30, 120]] }), "EUR")).toBeNull();
    expect(collectionCurve([], history({}), "EUR")).toBeNull();
    expect(collectionCurve([piece("a")], history({ a: [[30, 120]] }), null)).toBeNull();
  });
});

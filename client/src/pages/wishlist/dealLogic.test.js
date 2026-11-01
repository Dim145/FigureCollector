import { describe, expect, it } from "vitest";
import { dealIsMet, marketPrice } from "./dealLogic.js";

const row = (over) => ({
  max_price_amount: "150",
  max_price_currency: "EUR",
  msrp_amount: "200",
  msrp_currency: "EUR",
  provider_price_amount: null,
  provider_price_currency: null,
  provider_price_stale: false,
  ...over,
});

describe("marketPrice", () => {
  it("prefers the shop price, and says it did", () => {
    const m = marketPrice(row({ provider_price_amount: "120", provider_price_currency: "EUR" }));
    expect(m).toEqual({ amount: 120, currency: "EUR", source: "provider" });
  });

  it("measures the MSRP once the server has dropped a lost shop price", () => {
    // The sweep last saw 100 € forty days ago: the server sends no amount.
    const m = marketPrice(row({ provider_price_stale: true }));
    expect(m).toEqual({ amount: 200, currency: "EUR", source: "msrp" });
  });
});

describe("dealIsMet", () => {
  it("is not a deal at a price nobody is asking any more", () => {
    expect(dealIsMet(row({ provider_price_stale: true }), "EUR", null)).toBe(false);
    expect(dealIsMet(row({ provider_price_amount: "120", provider_price_currency: "EUR" }), "EUR", null)).toBe(true);
  });
});

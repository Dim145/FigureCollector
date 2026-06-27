import { describe, it, expect } from "vitest";
import {
  fmtMoney,
  rateToEur,
  toDisplay,
  sumInDisplay,
  effectiveValue,
  paidTotal,
  figurePaid,
} from "./money.js";

// Strip every non-digit so assertions don't depend on the locale's separators
// (fr-FR uses a narrow no-break space; the symbol/position vary too).
const digits = (s) => String(s).replace(/\D/g, "");

describe("fmtMoney", () => {
  it("returns the em-dash for non-finite amounts", () => {
    expect(fmtMoney(NaN, "EUR", "fr-FR")).toBe("—");
    expect(fmtMoney(undefined, "EUR", "fr-FR")).toBe("—");
    expect(fmtMoney("abc", "EUR", "fr-FR")).toBe("—");
  });

  it("renders JPY with ZERO decimals (the regression that was fixed)", () => {
    // A whole yen amount must not gain a ',00' — that was the old bug.
    expect(digits(fmtMoney(1500, "JPY", "fr-FR"))).toBe("1500");
  });

  it("drops a trailing .00 on whole EUR amounts but keeps real cents", () => {
    expect(digits(fmtMoney(3248, "EUR", "fr-FR"))).toBe("3248");
    expect(digits(fmtMoney(3248.55, "EUR", "fr-FR"))).toBe("324855");
  });

  it("falls back gracefully on an unknown currency code", () => {
    const out = fmtMoney(10, "XYZ", "en-US");
    expect(out).toContain("XYZ");
    expect(out).toContain("10");
  });

  it("defaults to EUR when the currency is missing", () => {
    expect(fmtMoney(5, null, "fr-FR")).toContain("€");
  });
});

describe("rateToEur", () => {
  it("treats EUR as the anchor (1) regardless of the table", () => {
    expect(rateToEur({}, "EUR")).toBe(1);
    expect(rateToEur(null, "eur")).toBe(1);
  });

  it("reads the table case-insensitively", () => {
    expect(rateToEur({ USD: 1.1 }, "usd")).toBe(1.1);
  });

  it("returns null for a missing, zero or negative rate", () => {
    expect(rateToEur({ USD: 1.1 }, "JPY")).toBeNull();
    expect(rateToEur({ USD: 0 }, "USD")).toBeNull();
    expect(rateToEur({ USD: -1 }, "USD")).toBeNull();
    expect(rateToEur(undefined, "USD")).toBeNull();
  });
});

describe("toDisplay", () => {
  it("returns null for a non-finite amount", () => {
    expect(toDisplay({}, "EUR", "x", "USD")).toBeNull();
  });

  it("does not convert when there is no target or it equals the source", () => {
    expect(toDisplay({ USD: 1.1 }, "", 10, "USD")).toMatchObject({
      converted: false,
      amount: 10,
    });
    expect(toDisplay({ USD: 1.1 }, "USD", 10, "USD")).toMatchObject({
      converted: false,
      amount: 10,
    });
  });

  it("flags an unconvertible amount when a rate is missing", () => {
    const r = toDisplay({ EUR: 1 }, "EUR", 10, "ZZZ");
    expect(r).toMatchObject({ converted: false, unconvertible: true, amount: 10 });
  });

  it("converts across currencies through EUR", () => {
    // 16000 JPY at 160 JPY/EUR == 100 EUR.
    const r = toDisplay({ JPY: 160, EUR: 1 }, "EUR", 16000, "JPY");
    expect(r.currency).toBe("EUR");
    expect(r.converted).toBe(true);
    expect(r.amount).toBeCloseTo(100, 6);
  });
});

describe("sumInDisplay", () => {
  it("sums mixed currencies into the display currency", () => {
    const buckets = [
      { v: 100, c: "EUR" },
      { v: 16000, c: "JPY" },
    ];
    const r = sumInDisplay({ JPY: 160, EUR: 1 }, "EUR", buckets, "v", "c");
    expect(r.amount).toBeCloseTo(200, 6);
    expect(r.converted).toBe(true);
    expect(r.partial).toBe(false);
  });

  it("marks the total partial and drops a bucket it cannot convert", () => {
    const buckets = [
      { v: 50, c: "ZZZ" },
      { v: 10, c: "EUR" },
    ];
    const r = sumInDisplay({ EUR: 1 }, "EUR", buckets, "v", "c");
    expect(r.amount).toBeCloseTo(10, 6);
    expect(r.partial).toBe(true);
  });

  it("handles an empty / nullish bucket list", () => {
    expect(sumInDisplay({}, "EUR", null, "v")).toMatchObject({ amount: 0, partial: false });
  });
});

describe("effectiveValue", () => {
  it("prefers the manual value, then provider price, then MSRP", () => {
    expect(
      effectiveValue({ value_amount: 1, provider_price_amount: 2, msrp_amount: 3 }),
    ).toMatchObject({ amount: 1, source: "manual", isManual: true });
    expect(effectiveValue({ provider_price_amount: 2, msrp_amount: 3 })).toMatchObject({
      amount: 2,
      source: "auto",
    });
    expect(effectiveValue({ msrp_amount: 3, msrp_currency: "EUR" })).toMatchObject({
      amount: 3,
      source: "msrp",
      currency: "EUR",
    });
  });

  it("falls back through the currency chain for a manual value", () => {
    expect(effectiveValue({ value_amount: 5, price_currency: "USD" }).currency).toBe("USD");
  });

  it("returns null when nothing is known or the amount is not finite", () => {
    expect(effectiveValue({})).toBeNull();
    expect(effectiveValue(null)).toBeNull();
    expect(effectiveValue({ value_amount: "nope" })).toBeNull();
  });
});

describe("paidTotal / figurePaid", () => {
  it("paidTotal is price + shipping (shipping optional)", () => {
    expect(paidTotal({ price_amount: 10, shipping_amount: 5, price_currency: "EUR" })).toMatchObject(
      { amount: 15, currency: "EUR" },
    );
    expect(paidTotal({ price_amount: 10 }).amount).toBe(10);
    expect(paidTotal({})).toBeNull();
  });

  it("figurePaid is the price only — shipping is a sunk cost", () => {
    expect(figurePaid({ price_amount: 10, shipping_amount: 5 }).amount).toBe(10);
    expect(figurePaid({})).toBeNull();
  });
});

import { describe, it, expect } from "vitest";
import { deriveStats } from "./preorderConstants.js";

const t = (k) => k; // labels are irrelevant to the money math
const base = { status: "preordered", price_currency: "EUR", release_date_current: "2099-01-01" };

describe("deriveStats — balance owed", () => {
  it("counts price minus deposit as still owed", () => {
    const s = deriveStats([{ ...base, price_amount: 100, deposit_amount: 30 }], t);
    expect(s.balanceByCcy.EUR).toBe(70);
    expect(s.depositsByCcy.EUR).toBe(30);
  });

  it("excludes a preorder whose balance is marked paid (balance_paid_at)", () => {
    const s = deriveStats(
      [{ ...base, price_amount: 100, deposit_amount: 30, balance_paid_at: "2026-06-01" }],
      t,
    );
    // Settled → nothing owed, matching the per-entry view (PreorderTimeline).
    expect(s.balanceByCcy.EUR ?? 0).toBe(0);
    // …but the deposit already paid still shows in the deposits stat.
    expect(s.depositsByCcy.EUR).toBe(30);
  });

  it("ignores received and cancelled preorders", () => {
    const s = deriveStats(
      [
        { ...base, status: "received", price_amount: 100, deposit_amount: 0 },
        { ...base, status: "cancelled", price_amount: 100, deposit_amount: 0 },
      ],
      t,
    );
    expect(s.balanceByCcy.EUR ?? 0).toBe(0);
    expect(s.total).toBe(2);
  });

  it("owes nothing when the deposit already covers the price", () => {
    const s = deriveStats([{ ...base, price_amount: 50, deposit_amount: 50 }], t);
    expect(s.balanceByCcy.EUR ?? 0).toBe(0);
  });

  it("sums owed per currency without cross-converting", () => {
    const s = deriveStats(
      [
        { ...base, price_amount: 100, deposit_amount: 0 },
        { ...base, price_currency: "JPY", price_amount: 8000, deposit_amount: 1000 },
      ],
      t,
    );
    expect(s.balanceByCcy.EUR).toBe(100);
    expect(s.balanceByCcy.JPY).toBe(7000);
  });
});

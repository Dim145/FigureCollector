import { describe, expect, it } from "vitest";
import { floorStats } from "./priceFloor.js";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 1);
const pt = (daysAgo, v, currency = "EUR") => ({ t: NOW - daysAgo * DAY, v, currency });

describe("floorStats", () => {
  it("returns null without any history", () => {
    expect(floorStats([], NOW)).toBeNull();
    expect(floorStats(undefined, NOW)).toBeNull();
  });

  it("reads a lone old change point as a flat history", () => {
    // The cron writes a row only when the price MOVES: a shop that has held
    // ¥24 800 for 45 days has exactly one row.
    const s = floorStats([pt(45, 24800, "JPY")], NOW);
    expect(s).not.toBeNull();
    expect(s.flat).toBe(true);
    expect(s.stableDays).toBe(45);
    expect(s.floor).toBe(24800);
    expect(s.currency).toBe("JPY");
    expect(s.points).toHaveLength(1);
  });

  it("keeps a first relevé from today hidden — a price, not a history", () => {
    expect(floorStats([pt(0.5, 120)], NOW)).toBeNull();
  });

  it("measures the distance above the floor on a moving price", () => {
    const s = floorStats([pt(30, 100), pt(20, 90), pt(5, 99)], NOW);
    expect(s.flat).toBe(false);
    expect(s.floor).toBe(90);
    expect(s.atFloor).toBe(false);
    expect(s.aboveFloorPct).toBeCloseTo(10);
    expect(s.stableDays).toBe(5);
  });

  it("compares only points in today's currency", () => {
    // Was EUR, the shop now charges JPY: the one JPY point is the whole story.
    const s = floorStats([pt(60, 150), pt(10, 24800, "JPY")], NOW);
    expect(s.currency).toBe("JPY");
    expect(s.points).toHaveLength(1);
    expect(s.flat).toBe(true);
    expect(s.stableDays).toBe(10);
  });
});

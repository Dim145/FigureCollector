import { describe, expect, it } from "vitest";
import { floorStats } from "./priceFloor.js";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 1);
const pt = (daysAgo, v, currency = "EUR") => ({ t: NOW - daysAgo * DAY, v, currency });
const ago = (days) => NOW - days * DAY;

describe("floorStats", () => {
  it("returns null without any history", () => {
    expect(floorStats([], { now: NOW })).toBeNull();
    expect(floorStats(undefined, { now: NOW })).toBeNull();
  });

  it("reads a lone old change point as a flat history", () => {
    // The cron writes a row only when the price MOVES: a shop that has held
    // ¥24 800 for 45 days has exactly one row.
    const s = floorStats([pt(45, 24800, "JPY")], { now: NOW, fetchedAt: ago(0.2) });
    expect(s).not.toBeNull();
    expect(s.flat).toBe(true);
    expect(s.stale).toBe(false);
    expect(s.stableDays).toBe(44);
    expect(s.floor).toBe(24800);
    expect(s.currency).toBe("JPY");
    expect(s.points).toHaveLength(1);
  });

  it("keeps a first relevé from today hidden — a price, not a history", () => {
    expect(floorStats([pt(0.5, 120)], { now: NOW, fetchedAt: ago(0.5) })).toBeNull();
  });

  it("measures the distance above the floor on a moving price", () => {
    const s = floorStats([pt(30, 100), pt(20, 90), pt(5, 99)], { now: NOW, fetchedAt: ago(1) });
    expect(s.flat).toBe(false);
    expect(s.floor).toBe(90);
    expect(s.atFloor).toBe(false);
    expect(s.aboveFloorPct).toBeCloseTo(10);
    expect(s.stableDays).toBe(4);
  });

  it("compares only points in today's currency", () => {
    // Was EUR, the shop now charges JPY: the one JPY point is the whole story.
    const s = floorStats([pt(60, 150), pt(10, 24800, "JPY")], { now: NOW, fetchedAt: ago(0) });
    expect(s.currency).toBe("JPY");
    expect(s.points).toHaveLength(1);
    expect(s.flat).toBe(true);
    expect(s.stableDays).toBe(10);
  });

  it("counts the plateau only up to the sweep's last read", () => {
    // Changed 45 days ago, last confirmed 12 days ago: 33 days are vouched
    // for, the last 12 are not.
    const s = floorStats([pt(45, 180)], { now: NOW, fetchedAt: ago(12) });
    expect(s.stableDays).toBe(33);
    expect(s.seenDaysAgo).toBe(12);
    expect(s.stale).toBe(false);
  });

  it("calls a price the sweep lost history, not stable", () => {
    // The shop stopped resolving 40 days ago; before, it held for 20 days.
    const s = floorStats([pt(60, 180)], { now: NOW, fetchedAt: ago(40), stale: true });
    expect(s).not.toBeNull();
    expect(s.stale).toBe(true);
    expect(s.seenDaysAgo).toBe(40);
    expect(s.stableDays).toBe(20);
  });

  it("hides a lone relevé the sweep never re-read — unless it lost it", () => {
    // Seen once, five days ago, never confirmed since: nothing has "held".
    expect(floorStats([pt(5, 180)], { now: NOW, fetchedAt: ago(5) })).toBeNull();
    // Seen once and the listing is gone: that is worth saying.
    const lost = floorStats([pt(40, 180)], { now: NOW, fetchedAt: ago(40), stale: true });
    expect(lost.stale).toBe(true);
    expect(lost.seenDaysAgo).toBe(40);
  });

  it("runs the plateau to now when the read time is unknown", () => {
    // A row from an older server, or a mirror written before it sent one.
    const s = floorStats([pt(45, 180)], { now: NOW, fetchedAt: Date.parse(undefined) });
    expect(s.stableDays).toBe(45);
    expect(s.seenDaysAgo).toBe(0);
  });
});

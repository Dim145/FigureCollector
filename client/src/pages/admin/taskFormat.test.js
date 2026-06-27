import { describe, it, expect } from "vitest";
import {
  clampPct,
  rel,
  durationMs,
  fmtDuration,
  execTime,
  formatJobResult,
  formatServiceDetail,
} from "./taskFormat.js";

// Stub translator: echoes the key, appending the interpolated count when given,
// so assertions can check WHICH key fired and with WHAT n without depending on
// the real locale bundle.
const t = (k, o) => (o && "n" in o ? `${k}|${o.n}` : k);

describe("clampPct", () => {
  it("clamps to 0..100 and rounds", () => {
    expect(clampPct(NaN)).toBe(0);
    expect(clampPct(-10)).toBe(0);
    expect(clampPct(150)).toBe(100);
    expect(clampPct(42.6)).toBe(43);
    expect(clampPct("50")).toBe(50);
  });
});

describe("rel", () => {
  it("is empty for a missing timestamp", () => {
    expect(rel("", t)).toBe("");
  });

  it("picks the bucket key by magnitude", () => {
    expect(rel(new Date(Date.now() - 30_000).toISOString(), t)).toMatch(/^admin\.tasks\.ago\.s\|/);
    expect(rel(new Date(Date.now() - 90_000).toISOString(), t)).toBe("admin.tasks.ago.m|1");
    expect(rel(new Date(Date.now() - 2 * 3_600_000).toISOString(), t)).toBe("admin.tasks.ago.h|2");
    expect(rel(new Date(Date.now() - 3 * 86_400_000).toISOString(), t)).toBe("admin.tasks.ago.d|3");
  });
});

describe("durationMs", () => {
  it("computes a non-negative span or null", () => {
    expect(durationMs("2020-01-01T00:00:00Z", "2020-01-01T00:00:05Z")).toBe(5000);
    expect(durationMs("2020-01-01T00:00:05Z", "2020-01-01T00:00:00Z")).toBeNull(); // clock skew
    expect(durationMs(null, "2020-01-01T00:00:05Z")).toBeNull();
  });
});

describe("fmtDuration / execTime", () => {
  it("formats sub-second, seconds and minutes (zero-padded)", () => {
    expect(fmtDuration(null)).toBeNull();
    expect(fmtDuration(500)).toBe("500 ms");
    expect(fmtDuration(5000)).toBe("5 s");
    expect(fmtDuration(65_000)).toBe("1 min 05 s");
    expect(fmtDuration(125_000)).toBe("2 min 05 s");
  });

  it("execTime composes durationMs + fmtDuration", () => {
    expect(execTime("2020-01-01T00:00:00Z", "2020-01-01T00:00:05Z")).toBe("5 s");
    expect(execTime(null, null)).toBeNull();
  });
});

describe("formatJobResult", () => {
  it("says 'nothing' for a missing or all-zero result", () => {
    expect(formatJobResult(null, t)).toBe("admin.tasks.result.nothing");
    expect(formatJobResult({}, t)).toBe("admin.tasks.result.nothing");
    expect(formatJobResult({ purged: 0, keep: 9 }, t)).toBe("admin.tasks.result.nothing");
  });

  it("localizes known counters and passes unknown keys through raw", () => {
    expect(formatJobResult({ updated: 42 }, t)).toBe("admin.tasks.result.k.updated|42");
    expect(formatJobResult({ foo: 3 }, t)).toBe("foo: 3");
    expect(formatJobResult({ updated: 42, foo: 3 }, t)).toBe(
      "admin.tasks.result.k.updated|42 · foo: 3",
    );
  });
});

describe("formatServiceDetail", () => {
  it("handles non-object detail", () => {
    expect(formatServiceDetail(null, t)).toBeNull();
    expect(formatServiceDetail("ready", t)).toBe("ready");
  });

  it("phrases nonzero numeric leaves, recursing one level into groups", () => {
    expect(formatServiceDetail({ active_jobs: 2 }, t)).toBe(
      "admin.tasks.services.detail.active_jobs|2",
    );
    const nested = formatServiceDetail({ queues: { tags: { pending: 3, processing: 0 } } }, t);
    expect(nested).toContain("queues tags");
    expect(nested).toContain("pending|3");
  });

  it("falls back to flat 'key: value' when every numeric leaf is zero", () => {
    expect(formatServiceDetail({ delivery_today: 0, release_j7: 0 }, t)).toBe(
      "delivery_today: 0 · release_j7: 0",
    );
    expect(formatServiceDetail({ mode: "idle" }, t)).toBe("mode: idle");
  });
});

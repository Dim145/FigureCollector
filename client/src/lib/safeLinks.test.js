import { describe, expect, it } from "vitest";
import { parseTrackingUrl } from "./carrierTracking.js";
import { safeHref } from "./safeUrl.js";

// Every external link target must come out http(s) or not at all. React 19
// rewrites `javascript:` hrefs at render time, but these helpers are the
// layer the app owns — they must hold on their own.
const HOSTILE = [
  "javascript://%0aalert(document.domain)",
  "JaVaScRiPt://%0aalert(1)",
  " javascript:alert(1)",
  "javascript:alert(1)",
  "data:text/html,<script>alert(1)</script>",
  "vbscript:msgbox(1)",
];

const httpOrNothing = (v) => v == null || /^https?:\/\//i.test(v);

describe("parseTrackingUrl", () => {
  it("never returns a script or data URL as the link target", () => {
    for (const input of HOSTILE) {
      const parsed = parseTrackingUrl(input);
      expect(httpOrNothing(parsed?.canonicalUrl), input).toBe(true);
    }
  });

  it("turns a bare carrier host into an absolute link, not a relative one", () => {
    const parsed = parseTrackingUrl("ups.com/track?tracknum=1Z999AA10123456784");
    expect(parsed.canonicalUrl.startsWith("https://")).toBe(true);
  });

  it("keeps an unknown carrier's own https URL", () => {
    const parsed = parseTrackingUrl("https://track.example.test/p/ABC12345");
    expect(parsed.knownCarrier).toBe(false);
    expect(parsed.canonicalUrl).toBe("https://track.example.test/p/ABC12345");
  });
});

describe("safeHref", () => {
  it("drops every non-http scheme", () => {
    for (const input of HOSTILE) expect(safeHref(input), input).toBeUndefined();
  });

  it("keeps same-origin paths but refuses protocol-relative ones", () => {
    expect(safeHref("/figures/1")).toBe("/figures/1");
    expect(safeHref("//evil.test/x")).toBeUndefined();
  });
});

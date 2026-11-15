import { describe, expect, it } from "vitest";
import { AUTO_CARRIER, parseTrackingUrl } from "./carrierTracking.js";

// Same cases as the server twin (server/src/external/tracking/parse.rs) —
// the two parsers must agree, or the watcher and the chip track different
// things.
const pick = (input) => {
  const p = parseTrackingUrl(input);
  return p ? [p.id, p.number] : null;
};

describe("parseTrackingUrl — carrier links", () => {
  it("finds carrier and number in a link", () => {
    expect(
      pick("https://www.laposte.fr/outils/suivre-vos-envois?code=6A12345678901"),
    ).toEqual(["colissimo", "6A12345678901"]);
    expect(
      pick(
        "trackings.post.japanpost.jp/services/srv/search/?reqCodeNo1=EX123456789JP&locale=en",
      ),
    ).toEqual(["japanpost", "EX123456789JP"]);
    expect(pick("https://www.dpd.com/tracking/01475251796393")).toEqual([
      "dpd",
      "01475251796393",
    ]);
  });
});

describe("parseTrackingUrl — bare numbers", () => {
  it("attributes unambiguous formats", () => {
    expect(pick("EX123456789JP")).toEqual(["japanpost", "EX123456789JP"]);
    expect(pick("cb123456789fr")).toEqual(["colissimo", "CB123456789FR"]);
    expect(pick("6A12345678901")).toEqual(["colissimo", "6A12345678901"]);
    expect(pick("1Z999AA10123456784")).toEqual(["ups", "1Z999AA10123456784"]);
    expect(pick("EX 123 456 789 JP")).toEqual(["japanpost", "EX123456789JP"]);
  });

  it("leaves the rest to server-side detection", () => {
    const p = parseTrackingUrl("01475251796393");
    expect(p.id).toBe(AUTO_CARRIER);
    expect(p.number).toBe("01475251796393");
    expect(p.name).toBe("");
    expect(p.canonicalUrl).toBe(
      "https://parcelsapp.com/en/tracking/01475251796393",
    );
  });

  it("links a known carrier's own tracking page", () => {
    expect(parseTrackingUrl("EX123456789JP").canonicalUrl).toMatch(
      /^https:\/\/trackings\.post\.japanpost\.jp\//,
    );
  });

  it("rejects strings that aren't tracking numbers", () => {
    // No digit, too short, a host, a stray character.
    expect(parseTrackingUrl("abcdefgh")?.number ?? null).toBeNull();
    expect(parseTrackingUrl("1234567")?.number ?? null).toBeNull();
    expect(parseTrackingUrl("ups.com")?.id).not.toBe(AUTO_CARRIER);
    expect(parseTrackingUrl("12345678_9")?.number ?? null).toBeNull();
  });
});

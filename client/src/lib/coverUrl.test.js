import { describe, it, expect } from "vitest";
import { resolveOwnedCover, resolveFigureCover, resolveFigureCoverSources } from "./coverUrl.js";

describe("resolveOwnedCover", () => {
  it("returns null for no item / no source", () => {
    expect(resolveOwnedCover(null)).toBeNull();
    expect(resolveOwnedCover({})).toBeNull();
  });

  it("prefers the pinned photo, cache-busting with the storage key", () => {
    expect(resolveOwnedCover({ cover_photo_id: "p1", cover_photo_key: "k 1" })).toBe(
      "/api/photos/p1?v=k%201", // key is URL-encoded
    );
    expect(resolveOwnedCover({ cover_photo_id: "p1" })).toBe("/api/photos/p1");
  });

  it("walks the priority chain: photo > scan > catalog > raw image", () => {
    expect(
      resolveOwnedCover({ cover_photo_id: "p1", cover_scan_id: "s1", catalog_cover_photo_id: "c1" }),
    ).toBe("/api/photos/p1");
    expect(resolveOwnedCover({ cover_scan_id: "s1", catalog_cover_photo_id: "c1" })).toBe(
      "/api/scans/s1/frames/0",
    );
    expect(resolveOwnedCover({ catalog_cover_photo_id: "c1" })).toBe("/api/figure-photos/c1");
    expect(resolveOwnedCover({ figure_image: "https://x/y.jpg" })).toBe("https://x/y.jpg");
  });
});

describe("resolveFigureCoverSources / resolveFigureCover", () => {
  it("returns null pair for a missing figure", () => {
    expect(resolveFigureCoverSources(null)).toEqual({ primary: null, fallback: null });
  });

  it("prefers the uploaded photo with the external image as fallback", () => {
    expect(
      resolveFigureCoverSources({ primary_photo_id: "p1", official_image_url: "https://x/o.jpg" }),
    ).toEqual({ primary: "/api/figure-photos/p1", fallback: "https://x/o.jpg" });
  });

  it("uses the external image as primary when there is no uploaded photo", () => {
    expect(resolveFigureCoverSources({ official_image_url: "https://x/o.jpg" })).toEqual({
      primary: "https://x/o.jpg",
      fallback: null,
    });
    expect(resolveFigureCoverSources({})).toEqual({ primary: null, fallback: null });
  });

  it("resolveFigureCover is the primary of the source pair", () => {
    expect(resolveFigureCover({ primary_photo_id: "p1" })).toBe("/api/figure-photos/p1");
    expect(resolveFigureCover({})).toBeNull();
  });
});

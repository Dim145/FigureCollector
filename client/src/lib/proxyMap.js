// Operator-proxy helpers shared by the add-figure lookup (FigureLookup) and
// the bulk wishlist importer — host routing + the ProxyProduct → figure
// mappings (single source of truth, no drift between the two flows).

import { mapCurrency, parseReleaseDate, splitMaterials } from "./orzgkMap.js";

/** Extract a lowercase hostname (without the `www.` prefix) from a
 *  user-pasted URL string. Returns null when the string isn't a
 *  parseable URL — callers fall back to free-text search in that case. */
export function hostnameOf(raw) {
  try {
    const host = new URL(raw).hostname.toLowerCase();
    return host.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** Test whether any of the proxy's `/stores` entries claims this host.
 *  Each `ProxyStore.hosts` is an array of bare hostnames the proxy can
 *  scrape; matching is case-insensitive and ignores leading `www.`. */
export function proxyHandles(stores, host) {
  return proxyStoreFor(stores, host) != null;
}

/** The `/stores` entry claiming this host, or null. */
export function proxyStoreFor(stores, host) {
  const needle = (host ?? "").replace(/^www\./, "").toLowerCase();
  if (!needle) return null;
  return (
    (stores ?? []).find((s) =>
      (s.hosts ?? []).some(
        (h) => (h ?? "").replace(/^www\./, "").toLowerCase() === needle,
      ),
    ) ?? null
  );
}

/** Map a ProxyProduct onto the figure FORM (string-typed fields) — the shape
 *  `FigureLookup.applyPick` feeds into FigureForm. Kept byte-identical to the
 *  historical inline mapping so the add-figure flow doesn't change. */
export function proxyProductToPick(p) {
  return {
    name: p.title,
    manufacturer_name: p.manufacturer ?? undefined,
    series_name: p.series ?? undefined,
    character_name: p.character ?? undefined,
    scale: p.scale ?? undefined,
    height_mm: p.height_mm != null ? String(p.height_mm) : undefined,
    materials: p.materials ?? undefined,
    official_image_url: p.primary_image_url ?? undefined,
    msrp_amount:
      p.price?.amount != null ? String(p.price.amount.toFixed(2)) : undefined,
    msrp_currency: p.price?.currency ?? undefined,
    release_date: p.release_date ?? undefined,
    description: p.description ?? undefined,
    is_nsfw: p.is_nsfw || undefined,
    source_url: p.url,
  };
}

/** Map a ProxyProduct straight onto a `NewFigure` payload (typed: numbers,
 *  arrays, ISO date) for the bulk importer's direct POST /figures — the
 *  proxy twin of orzgkMap's `buildPick`. */
export function proxyProductToNewFigure(p) {
  return {
    name: p.title,
    manufacturer_name: p.manufacturer ?? undefined,
    series_name: p.series ?? undefined,
    character_name: p.character ?? undefined,
    scale: p.scale ?? undefined,
    height_mm: p.height_mm ?? undefined,
    materials: splitMaterials(p.materials),
    official_image_url: p.primary_image_url ?? undefined,
    msrp_amount: p.price?.amount != null ? p.price.amount.toFixed(2) : undefined,
    msrp_currency: mapCurrency(p.price?.currency),
    release_date: parseReleaseDate(p.release_date),
    description: p.description ?? undefined,
    is_nsfw: p.is_nsfw || undefined,
    // The backend auto-links the new figure to the matching store by hostname.
    source_url: p.url,
  };
}

/** Map one `/wishlist` row onto the importer's internal item shape (the same
 *  shape orzgk wish items use, plus `source` for the commit dispatch). */
export function proxyWishToItem(w) {
  return {
    title: w.title,
    studio: w.manufacturer ?? null,
    version: w.version ?? null,
    price:
      w.price?.amount != null
        ? `${w.price.amount.toFixed(2)} ${w.price.currency ?? ""}`.trim()
        : null,
    image_url: w.image_url ?? null,
    detail_url: w.url,
    source: "proxy",
  };
}

// Operator-proxy helpers shared by the add-figure lookup (FigureLookup) and
// the bulk wishlist importer — host routing + the ProxyProduct → figure
// mappings (single source of truth, no drift between the two flows).
//
// Kept separate from orzgkMap because the proxy product already gives us
// clean, normalised fields (often an ISO release_date, computed is_nsfw, …) —
// those are passed through rather than re-derived; only free-form leftovers
// ("2026-Q3") go through orzgkMap's parsers.

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

/** Image to show / import: the chosen version's image, else the product hero. */
export function pickProxyImage(product, version) {
  return version?.image_url ?? product?.primary_image_url ?? null;
}

/** Map a ProxyProduct + chosen version/price onto the figure FORM payload
 *  (string-typed fields — FigureForm normalises them on submit). */
export function buildProxyPick(product, version, price) {
  // msrp: the explicitly-picked tariff wins, else the version's "full" tariff,
  // else the product's flat price.
  const amount =
    price?.amount ??
    version?.prices?.find((p) => /full/i.test(p.label))?.amount ??
    product.price?.amount;
  const currency =
    price?.currency ?? version?.prices?.[0]?.currency ?? product.price?.currency;

  return {
    name: product.title,
    manufacturer_name: product.manufacturer ?? undefined,
    series_name: product.series ?? undefined,
    character_name: product.character ?? undefined,
    scale: product.scale ?? undefined,
    height_mm: product.height_mm != null ? String(product.height_mm) : undefined,
    materials: product.materials ?? undefined,
    official_image_url: pickProxyImage(product, version) ?? undefined,
    msrp_amount: amount != null ? String(Number(amount).toFixed(2)) : undefined,
    msrp_currency: mapCurrency(currency),
    release_date: product.release_date ?? undefined,
    description: product.description ?? undefined,
    is_nsfw: product.is_nsfw || undefined,
    version_name: version?.label,
    // The pasted URL — the backend uses its hostname to auto-link the new
    // figure to the matching store at create time.
    source_url: product.url,
  };
}

/** Default selection for a product imported without opening the picker: the
 *  first version (if any) and its "full" tariff (else the first tariff). */
export function defaultProxyPick(product) {
  const version = product.versions?.[0] ?? null;
  const prices = version?.prices ?? [];
  const price = prices.find((p) => /full/i.test(p.label)) ?? prices[0] ?? null;
  return buildProxyPick(product, version, price);
}

/** Pick the product version matching `preferredLabel` (the variant the user
 *  wished), else the first. Mirrors orzgkMap's autoPickFromDetail selection. */
function resolveVersion(product, preferredLabel) {
  const versions = product.versions ?? [];
  if (!versions.length) return null;
  if (preferredLabel) {
    const want = preferredLabel.trim().toLowerCase();
    const hit = versions.find((v) => (v.label ?? "").trim().toLowerCase() === want);
    if (hit) return hit;
  }
  return versions[0];
}

/** Already `YYYY-MM-DD`? Pass through; else try orzgkMap's free-form parser
 *  ("2026-Q3", "2026/10"). `NewFigure.release_date` only accepts ISO dates. */
function isoReleaseDate(raw) {
  if (!raw) return undefined;
  const s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return parseReleaseDate(s);
}

/** Map a ProxyProduct straight onto a `NewFigure` payload (typed: numbers,
 *  arrays, ISO date) for the bulk importer's direct POST /figures — the proxy
 *  twin of orzgkMap's `autoPickFromDetail`. `preferredVersionLabel` is the
 *  wished variant from the proxy wishlist row, when known. */
export function proxyProductToNewFigure(product, preferredVersionLabel) {
  const version = resolveVersion(product, preferredVersionLabel);
  const prices = version?.prices ?? [];
  const price = prices.find((p) => /full/i.test(p.label)) ?? prices[0] ?? null;
  const amount = price?.amount ?? product.price?.amount;
  const currency = price?.currency ?? product.price?.currency;

  return {
    name: product.title,
    manufacturer_name: product.manufacturer ?? undefined,
    series_name: product.series ?? undefined,
    character_name: product.character ?? undefined,
    scale: product.scale ?? undefined,
    height_mm: product.height_mm ?? undefined,
    materials: splitMaterials(product.materials),
    official_image_url: pickProxyImage(product, version) ?? undefined,
    msrp_amount: amount != null ? Number(amount).toFixed(2) : undefined,
    msrp_currency: mapCurrency(currency),
    release_date: isoReleaseDate(product.release_date),
    description: product.description ?? undefined,
    is_nsfw: product.is_nsfw || undefined,
    version_name: version?.label,
    // The backend auto-links the new figure to the matching store by hostname.
    source_url: product.url,
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

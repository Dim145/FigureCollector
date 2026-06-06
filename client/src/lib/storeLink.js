import { safeHref } from "./safeUrl.js";

/**
 * Reassemble a figure's buy URL from the two halves the backend stores apart:
 * the store's base `url` (scheme + host, on the stores row) and the per-figure
 * `link` (path + query, on the figure_stores row).
 *
 * `new URL(link, base)` resolves the absolute `/path?query` against the base's
 * origin — exactly the "scheme+host on the store, path+query on the link"
 * model. Guarded by `safeHref` so a poisoned value can never become an active
 * href. Returns `undefined` when either half is missing or the result isn't a
 * safe http(s) URL, so callers simply omit the affordance.
 *
 * @param {string | null | undefined} storeUrl  base URL of the store
 * @param {string | null | undefined} link       path + query of the product page
 * @returns {string | undefined}
 */
export function buildBuyUrl(storeUrl, link) {
  if (typeof storeUrl !== "string" || typeof link !== "string") return undefined;
  if (!storeUrl.trim() || !link.trim()) return undefined;
  try {
    return safeHref(new URL(link, storeUrl).href);
  } catch {
    return undefined;
  }
}

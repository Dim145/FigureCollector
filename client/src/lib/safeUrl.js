// Guards href sinks against URL-borne XSS. `javascript:`, `data:`, `vbscript:`
// and other scheme payloads parse fine as URLs but execute when placed in an
// <a href>; this helper only lets http(s) (and root-relative) URLs through so a
// poisoned external_url / store url can never become an active href.

/**
 * Returns `url` only when it is a safe href target: an absolute `http:`/`https:`
 * URL, or a root-relative `/...` path. Returns `undefined` otherwise (notably
 * for `javascript:` / `data:` / other scheme payloads), so callers can skip the
 * link rather than render a dead or dangerous `href`.
 *
 * @param {unknown} url
 * @returns {string | undefined}
 */
export function safeHref(url) {
  if (typeof url !== "string") return undefined;
  const u = url.trim();
  if (u.startsWith("/") && !u.startsWith("//")) return u; // internal relative
  try {
    const parsed = new URL(u);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? u : undefined;
  } catch {
    return undefined;
  }
}

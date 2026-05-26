import { useQuery } from "@tanstack/react-query";
import { api, ApiError } from "../lib/api.js";

// =============================================================================
// External scraping proxy — client hooks.
//
// All three hooks gracefully degrade when the proxy isn't configured: the
// backend returns `error: "feature_disabled"`, which TanStack Query
// surfaces via `query.isError + error.code === "feature_disabled"`. The
// FigureLookup UI hides the proxy widgets in that case (rather than
// showing an empty list or a confusing error).
// =============================================================================

/** Whether the proxy is wired up. Drives the "show proxy lookup UI" gate.
 *  Returns `{ enabled, stores, loading }` so callers can render a
 *  "fetching stores…" state without committing to enable/disable yet. */
export function useProxyEnabled() {
  const q = useQuery({
    queryKey: ["proxy", "stores"],
    queryFn: () => api.get("/external/proxy/stores"),
    // 5 minutes is plenty — the proxy's supported-stores list moves
    // glacially. A stale-while-revalidate cache keeps the gating UI
    // snappy on subsequent renders.
    staleTime: 5 * 60_000,
    retry: false,
  });

  // `feature_disabled` isn't a real error here — it's the documented
  // "no proxy configured" signal. Treat it as a clean "off" so the
  // surrounding UI doesn't show an error toast for an intended state.
  const disabled = q.isError && q.error instanceof ApiError
    && q.error.code === "feature_disabled";

  return {
    enabled: !disabled && Array.isArray(q.data) && q.data.length > 0,
    stores: Array.isArray(q.data) ? q.data : [],
    loading: q.isLoading,
    error: disabled ? null : q.error,
  };
}

/** Search the proxy. `store` is optional; pass undefined to fan out
 *  across every boutique the proxy supports. */
export function useProxySearch(q, store) {
  const enabled = (q ?? "").trim().length >= 2;
  return useQuery({
    queryKey: ["proxy", "search", q?.trim() ?? "", store ?? ""],
    queryFn: () => {
      const params = new URLSearchParams({ q: q.trim() });
      if (store) params.set("store", store);
      return api.get(`/external/proxy/search?${params.toString()}`);
    },
    enabled,
    staleTime: 60_000,
  });
}

/** Resolve one product by URL. Used by the URL-paste flow when the
 *  pasted host belongs to a proxy-supported store. */
export async function fetchProxyProduct(url) {
  return api.get(`/external/proxy/product?url=${encodeURIComponent(url)}`);
}

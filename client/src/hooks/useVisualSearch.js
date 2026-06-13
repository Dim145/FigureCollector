import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api.js";

/**
 * GET /api/visual-search/status — the photo-search feature flag plus index
 * readiness ({ enabled, model_version, embedded, pending, ready,
 * worker_present }).
 *
 * Shared (cached) between the navigation — which only surfaces the
 * "Reconnaître par photo" entry when the feature is enabled — and
 * RecognizePage. Fails closed: a network/permission error leaves `enabled`
 * undefined, so the entry simply doesn't appear.
 */
export function useVisualSearchStatus(options = {}) {
  return useQuery({
    queryKey: ["visual-search", "status"],
    queryFn: () => api.get("/visual-search/status"),
    staleTime: 5 * 60 * 1000, // the admin flag rarely flips mid-session
    retry: false,
    ...options,
  });
}

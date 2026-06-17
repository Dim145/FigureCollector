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

/**
 * GET /api/figures/{id}/similar — the "figurines proches" rail: catalog
 * neighbours of a figure by DINOv2 cosine distance. Returns `[]` (so the rail
 * hides) when the figure isn't on the index yet. Gate the caller on the
 * feature flag via `options.enabled` so it doesn't fire when search is off.
 */
export function useSimilarFigures(figureId, options = {}) {
  return useQuery({
    queryKey: ["visual-search", "similar", figureId],
    queryFn: () => api.get(`/figures/${figureId}/similar`),
    staleTime: 5 * 60 * 1000,
    retry: false,
    ...options,
  });
}

/**
 * GET /api/me/recommendations — the "reco par goût" rail: catalogue figures
 * nearest to what the user owns, minus what they already own or wishlist.
 * Returns `[]` (rail hides) when they own nothing on the index. Gate the caller
 * on the feature flag via `options.enabled`.
 */
export function useRecommendations(options = {}) {
  return useQuery({
    queryKey: ["visual-search", "recommendations"],
    queryFn: () => api.get("/me/recommendations"),
    staleTime: 5 * 60 * 1000,
    retry: false,
    ...options,
  });
}

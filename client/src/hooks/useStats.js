import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api.js";

/**
 * Whole-collection aggregate stats — type / condition / spend / top series & co.
 * Cached for a minute; LiveSyncProvider invalidates `["stats"]` on mutations.
 */
export function useMyStats() {
  return useQuery({
    queryKey: ["stats"],
    queryFn: () => api.get("/me/stats"),
    staleTime: 60_000,
  });
}

/**
 * Deeper insights (Lot 5): spend-by-year, series completion, wishlist value,
 * preorder health. Separate endpoint from the headline stats.
 */
export function useInsights() {
  return useQuery({
    queryKey: ["insights"],
    queryFn: () => api.get("/me/insights"),
    staleTime: 60_000,
  });
}

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

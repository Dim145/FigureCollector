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

/**
 * Collection over time (#10): monthly buckets of pieces added + outlay added
 * (per currency), reconstructed from owned-item dates/prices. The page folds
 * these into a cumulative items + cumulative spend curve. Same one-minute stale
 * as the headline stats; LiveSyncProvider invalidates `["timeline"]` on
 * collection mutations.
 */
export function useMyTimeline() {
  return useQuery({
    queryKey: ["timeline"],
    queryFn: () => api.get("/me/timeline"),
    staleTime: 60_000,
  });
}

/**
 * Market-price history for every figure the user owns (oldest first, tagged by
 * figure). One round-trip feeding the Cote page graphs — per-row sparklines,
 * expanded registres, and the reconstructed collection curve. The data only
 * moves when the price cron runs, so a long stale is safe.
 */
export function useMyPriceHistory() {
  return useQuery({
    queryKey: ["price-history", "me"],
    queryFn: () => api.get("/me/price-history"),
    staleTime: 5 * 60_000,
  });
}

/** Market-price history for one figure (oldest first) — the figure page's
 *  cote sparkline + évolution dialog. */
export function useFigurePriceHistory(figureId, { enabled = true } = {}) {
  return useQuery({
    queryKey: ["price-history", figureId],
    queryFn: () => api.get(`/figures/${figureId}/price-history`),
    enabled: enabled && !!figureId,
    staleTime: 5 * 60_000,
  });
}

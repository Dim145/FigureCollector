import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api.js";
import { withOutbox } from "../lib/outbox.js";

/** The signed-in user's wishlist (catalogue figures they covet). */
export function useWishlistItems() {
  return useQuery({
    queryKey: ["wishlist"],
    queryFn: () => api.get("/me/wishlist"),
  });
}

/** Add a figure to the wishlist (idempotent — re-adding updates target/note).
 *  Payload: { figure_id, max_price_amount?, max_price_currency?, note? }. */
/**
 * Market-price history for every wished figure (one round-trip, tagged by
 * figure id). Powers the per-row sparkline and the "how far above its observed
 * floor is this?" read — the question a wishlist actually exists to answer.
 *
 * Cached longer than the list itself: the cron writes a point at most once a
 * day, so re-fetching on every focus would be pure noise.
 */
export function useWishlistPriceHistory(enabled = true) {
  return useQuery({
    queryKey: ["wishlist", "price-history"],
    queryFn: () => api.get("/me/wishlist/price-history"),
    staleTime: 10 * 60 * 1000,
    enabled,
  });
}

export function useAddWishlistItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload) =>
      withOutbox("wishlist.add", payload, () => api.post("/me/wishlist", payload)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["wishlist"] }),
  });
}

/** Update a wishlist entry's target price / note (direct set — null clears). */
export function usePatchWishlistItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ figure_id, patch }) => api.patch(`/me/wishlist/${figure_id}`, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["wishlist"] }),
  });
}

export function useRemoveWishlistItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (figureId) => api.delete(`/me/wishlist/${figureId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["wishlist"] }),
  });
}

// ----- Bulk import (orzgk wishlist / proxy-handled boutiques) ----------------

/** Resolve an import source into wish items. Pass `{ url }` for a public
 *  orzgk share link (server fetch, paginated), `{ url, via: "proxy" }` for a
 *  list on a boutique the operator proxy handles, or `{ html }` for the
 *  paste-the-page fallback (private orzgk lists). Read-only. */
export function useResolveImport() {
  return useMutation({
    mutationFn: ({ url, html, via }) =>
      html != null
        ? api.post("/external/orzgk/wishlist/parse", { html })
        : via === "proxy"
          ? api.get(`/external/proxy/wishlist?url=${encodeURIComponent(url)}`)
          : api.get(`/external/orzgk/wishlist?url=${encodeURIComponent(url)}`),
  });
}

/** Batch fuzzy-match figure names against the catalogue (trigram). Input is
 *  `[{ name, manufacturer? }]`; returns one candidate list (top 3) per query,
 *  in the same order. */
export function useFigureMatch() {
  return useMutation({
    mutationFn: (queries) => api.post("/figures/match", { queries }),
  });
}

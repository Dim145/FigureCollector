import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api.js";

/** The signed-in user's wishlist (catalogue figures they covet). */
export function useWishlistItems() {
  return useQuery({
    queryKey: ["wishlist"],
    queryFn: () => api.get("/me/wishlist"),
  });
}

/** Add a figure to the wishlist (idempotent — re-adding updates target/note).
 *  Payload: { figure_id, max_price_amount?, max_price_currency?, note? }. */
export function useAddWishlistItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload) => api.post("/me/wishlist", payload),
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

// ----- Bulk import (from an orzgk public wishlist) ---------------------------

/** Resolve an import source into orzgk wishlist items. Pass `{ url }` for a
 *  public share link (server fetch, paginated) or `{ html }` for the
 *  paste-the-page fallback (private lists). Read-only — no cache to touch. */
export function useResolveImport() {
  return useMutation({
    mutationFn: ({ url, html }) =>
      html != null
        ? api.post("/external/orzgk/wishlist/parse", { html })
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

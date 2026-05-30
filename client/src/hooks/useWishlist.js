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

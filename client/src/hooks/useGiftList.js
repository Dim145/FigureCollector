import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api.js";

// ── Owner side (authenticated) ───────────────────────────────────────────────

/** The signed-in user's gift-list share state: `{ enabled, token }`. */
export function useGiftShare() {
  return useQuery({
    queryKey: ["gift-share"],
    queryFn: () => api.get("/me/gift-list"),
  });
}

/** Enable sharing (mint the token if absent). Idempotent server-side. */
export function useEnableGiftShare() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post("/me/gift-list/share"),
    onSuccess: (data) => qc.setQueryData(["gift-share"], data),
  });
}

/** Disable sharing — kills the link and wipes every reservation. */
export function useDisableGiftShare() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.delete("/me/gift-list/share"),
    onSuccess: () => qc.setQueryData(["gift-share"], { enabled: false, token: null }),
  });
}

// ── Public side (anonymous, by token) ────────────────────────────────────────

/** A shared gift list by token. Anonymous-friendly — no session required.
 *  `revealNsfw` only matters for anonymous viewers (signed-in viewers are
 *  gated by their own NSFW setting server-side); it appends `?nsfw=1`. */
export function useSharedWishlist(token, revealNsfw = false) {
  return useQuery({
    queryKey: ["gift", token, revealNsfw],
    queryFn: () => api.get(`/g/${token}${revealNsfw ? "?nsfw=1" : ""}`),
    enabled: !!token,
    retry: false,
  });
}

/** Claim a piece. Returns `{ reserver_token }` — the secret to release later. */
export function useReserveGift(token) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ figure_id, reserver_name }) =>
      api.post(`/g/${token}/reserve`, { figure_id, reserver_name }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["gift", token] }),
  });
}

/** Release a claim — needs the `reserver_token` handed back at reserve time. */
export function useReleaseGift(token) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ figure_id, reserver_token }) =>
      api.post(`/g/${token}/release`, { figure_id, reserver_token }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["gift", token] }),
  });
}

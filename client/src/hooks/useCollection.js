import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, api } from "../lib/api.js";

// ----- Figures (catalog) -----------------------------------------------------

export function useFigures(params = {}) {
  const search = new URLSearchParams();
  if (params.q) search.set("q", params.q);
  if (params.figure_type) search.set("figure_type", params.figure_type);
  if (params.manufacturer) search.set("manufacturer", params.manufacturer);
  const qs = search.toString();
  return useQuery({
    queryKey: ["figures", params],
    queryFn: () => api.get(`/figures${qs ? `?${qs}` : ""}`),
    // The service worker is configured StaleWhileRevalidate on /api/figures
    // so the SW will serve the in-cache list immediately. Force TanStack to
    // refetch on mount so a deleted figure doesn't linger as a clickable
    // card after the SW snapshot has gone stale.
    refetchOnMount: "always",
  });
}

export function useFigure(id) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["figure", id],
    queryFn: () => api.get(`/figures/${id}`),
    enabled: !!id,
  });
  // When a figure detail returns 404, the catalog list very likely has a
  // stale card pointing at the vanished figure. Drop the listing cache so
  // the next visit to /browse refetches and the dangling card disappears.
  useEffect(() => {
    if (query.error instanceof ApiError && query.error.status === 404) {
      qc.invalidateQueries({ queryKey: ["figures"] });
    }
  }, [query.error, qc]);
  return query;
}

export function useCreateFigure() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload) => api.post("/figures", payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["figures"] }),
  });
}

// ----- Owned items (collection) ---------------------------------------------

export function useOwnedItems() {
  return useQuery({
    queryKey: ["owned"],
    queryFn: () => api.get("/me/owned"),
  });
}

export function useAddOwnedItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload) => api.post("/me/owned", payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["owned"] }),
  });
}

export function useRemoveOwnedItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => api.delete(`/me/owned/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["owned"] }),
  });
}

/** Patch an owned-item row. Server-side fields: condition, price_amount,
 *  price_currency, store, purchase_date, location, notes. Missing keys are
 *  treated as "leave alone" (COALESCE), so callers can send only what they
 *  actually changed. */
export function useUpdateOwnedItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }) => api.patch(`/me/owned/${id}`, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["owned"] }),
  });
}

// ----- Pre-orders ------------------------------------------------------------

export function usePreorders() {
  return useQuery({
    queryKey: ["preorders"],
    queryFn: () => api.get("/me/preorders"),
  });
}

export function useCreatePreorder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload) => api.post("/me/preorders", payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["preorders"] }),
  });
}

export function useUpdatePreorder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }) => api.patch(`/me/preorders/${id}`, patch),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["preorders"] });
      qc.invalidateQueries({ queryKey: ["preorder-history", vars.id] });
    },
  });
}

export function useDeletePreorder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => api.delete(`/me/preorders/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["preorders"] }),
  });
}

export function usePreorderHistory(id) {
  return useQuery({
    queryKey: ["preorder-history", id],
    queryFn: () => api.get(`/me/preorders/${id}/history`),
    enabled: !!id,
  });
}

/** Patch the free-form `note` on a single slip-history entry. Re-uses the
 *  same query-key invalidation as the parent preorder so the timeline
 *  refreshes immediately. */
export function useUpdatePreorderHistory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ preorderId, entryId, note }) =>
      api.patch(`/me/preorders/${preorderId}/history/${entryId}`, { note }),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["preorder-history", vars.preorderId] });
    },
  });
}

/** Returns the (optional) preorder row auto-linked to a specific owned_item.
 *  Used by FigureDetailPage to render "Historique de pré-commande" even
 *  after the piece has been received. */
export function usePreorderForOwned(ownedId) {
  return useQuery({
    queryKey: ["preorder-for-owned", ownedId],
    queryFn: () => api.get(`/me/owned/${ownedId}/preorder`),
    enabled: !!ownedId,
  });
}

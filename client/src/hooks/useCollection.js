import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, api } from "../lib/api.js";

// ----- Figures (catalog) -----------------------------------------------------

export function useFigures(params = {}, { enabled = true } = {}) {
  const search = new URLSearchParams();
  if (params.q) search.set("q", params.q);
  if (params.figure_type) search.set("figure_type", params.figure_type);
  if (params.manufacturer) search.set("manufacturer", params.manufacturer);
  const qs = search.toString();
  return useQuery({
    queryKey: ["figures", params],
    queryFn: () => api.get(`/figures${qs ? `?${qs}` : ""}`),
    // Catalog freshness matters more than skipping a network round-trip:
    // every visit to /browse or /collection refetches even within the
    // default 30 s stale window. Paired with the SW's NetworkFirst
    // strategy on `/api/figures*`, this guarantees newly-created figures
    // (or freshly-changed primary photos) appear on the very next
    // navigation, without forcing a full page reload.
    refetchOnMount: "always",
    enabled,
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

/** Live duplicate check for the create form — catalogue figures matching by
 *  JAN (strong) or name (soft). Disabled until there's something to match on. */
export function useFigureDuplicates(name, jan, { enabled = true } = {}) {
  const n = (name ?? "").trim();
  const j = (jan ?? "").trim();
  const search = new URLSearchParams();
  if (n) search.set("name", n);
  if (j) search.set("jan", j);
  return useQuery({
    queryKey: ["figure-duplicates", n, j],
    queryFn: () => api.get(`/figures/duplicates?${search.toString()}`),
    enabled: enabled && (n.length >= 3 || j.length >= 6),
    staleTime: 15_000,
  });
}

// ----- Owned items (collection) ---------------------------------------------

export function useOwnedItems({ enabled = true, includeArchived = false } = {}) {
  // Cache key includes the flag so the active-only and include-archived
  // views don't collide. Both fetch the same endpoint with different qs.
  return useQuery({
    queryKey: ["owned", { includeArchived }],
    queryFn: () =>
      api.get(`/me/owned${includeArchived ? "?include_archived=true" : ""}`),
    enabled,
  });
}

export function useAddOwnedItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload) => api.post("/me/owned", payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["owned"] });
      // Owning a figure clears any matching wish server-side (owned ≠
      // wishlist), so refresh the wishlist + the catalogue markers that
      // derive from it.
      qc.invalidateQueries({ queryKey: ["wishlist"] });
    },
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

/** Set or clear an owned item's manual current value (the "cote").
 *  `amount: null` clears it, reverting the displayed value to the catalog-MSRP
 *  fallback. Invalidates the collection list AND `["stats"]` (the Cote
 *  dashboard reads `value_by_currency`). */
export function useSetOwnedValue() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, amount, currency }) =>
      api.put(`/me/owned/${id}/value`, { amount, currency }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["owned"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
    },
  });
}

/** Re-home + re-order a whole Vitrines cabinet in one call (drag-and-drop):
 *  every id in `ordered_ids` gets `location` + a sequential sort order. */
export function useArrangeOwned() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ location, ordered_ids }) =>
      api.put("/me/owned/arrange", { location, ordered_ids }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["owned"] }),
  });
}

/** Archive an owned item (typically after a partial-refund cancellation).
 *  The row keeps existing on disk so the loss can be retraced, but it's
 *  hidden from default list views. */
export function useArchiveOwnedItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => api.post(`/me/owned/${id}/archive`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["owned"] }),
  });
}

/** Bring an archived owned item back into the active collection. The user
 *  typically pairs this with editing the linked preorder back to a fresh
 *  status (the preorder row is untouched by this call). */
export function useRestoreOwnedItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => api.post(`/me/owned/${id}/restore`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["owned"] }),
  });
}

// ----- Display cabinets (locations) -----------------------------------------

/** The user's persistent display cabinets ("vitrines"), ordered. */
export function useLocations() {
  return useQuery({
    queryKey: ["locations"],
    queryFn: () => api.get("/me/locations"),
  });
}

/** Create a cabinet (idempotent server-side — an existing name is returned). */
export function useCreateLocation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name) => api.post("/me/locations", { name }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["locations"] }),
  });
}

/** Rename a cabinet; the server re-points its items so `owned.location` stays
 *  in sync, hence the `["owned"]` invalidation too. */
export function useRenameLocation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }) => api.patch(`/me/locations/${id}`, { name }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["locations"] });
      qc.invalidateQueries({ queryKey: ["owned"] });
    },
  });
}

/** Delete a cabinet; its pieces are un-shelved (location → ""). */
export function useDeleteLocation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => api.delete(`/me/locations/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["locations"] });
      qc.invalidateQueries({ queryKey: ["owned"] });
    },
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
      // OwnedItemEditor + PreorderHistory both read the preorder via
      // `usePreorderForOwned(ownedId)` — without this invalidation the
      // popup keeps showing pre-cancellation deposit / status until a
      // manual reload.
      qc.invalidateQueries({ queryKey: ["preorder-for-owned"] });
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

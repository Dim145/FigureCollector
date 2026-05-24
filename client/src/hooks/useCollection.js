import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api.js";

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
  });
}

export function useFigure(id) {
  return useQuery({
    queryKey: ["figure", id],
    queryFn: () => api.get(`/figures/${id}`),
    enabled: !!id,
  });
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

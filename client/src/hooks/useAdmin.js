import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api.js";

// -------------------- overview --------------------

export function useAdminOverview() {
  return useQuery({
    queryKey: ["admin", "overview"],
    queryFn: () => api.get("/admin/overview"),
    staleTime: 30_000,
  });
}

// -------------------- users --------------------

export function useAdminUsers() {
  return useQuery({
    queryKey: ["admin", "users"],
    queryFn: () => api.get("/admin/users"),
    staleTime: 10_000,
  });
}

export function useCreateAdminUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload) => api.post("/admin/users", payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "users"] });
      qc.invalidateQueries({ queryKey: ["admin", "overview"] });
    },
  });
}

export function usePatchAdminUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }) => api.patch(`/admin/users/${id}`, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "users"] });
      qc.invalidateQueries({ queryKey: ["admin", "overview"] });
      qc.invalidateQueries({ queryKey: ["me"] });
    },
  });
}

export function useDeleteAdminUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => api.delete(`/admin/users/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "users"] });
      qc.invalidateQueries({ queryKey: ["admin", "overview"] });
    },
  });
}

// -------------------- catalog (admin-wide) --------------------

export function useAdminFigures(params = {}) {
  const qs = new URLSearchParams();
  if (params.q) qs.set("q", params.q);
  if (params.figure_type) qs.set("figure_type", params.figure_type);
  const s = qs.toString();
  return useQuery({
    queryKey: ["admin", "figures", params],
    queryFn: () => api.get(`/admin/figures${s ? `?${s}` : ""}`),
    staleTime: 10_000,
  });
}

export function usePatchFigure() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }) => api.patch(`/figures/${id}`, patch),
    onSuccess: (_d, { id }) => {
      qc.invalidateQueries({ queryKey: ["figures"] });
      qc.invalidateQueries({ queryKey: ["figure", id] });
      qc.invalidateQueries({ queryKey: ["admin", "figures"] });
    },
  });
}

export function useDeleteFigure() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => api.delete(`/figures/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["figures"] });
      qc.invalidateQueries({ queryKey: ["admin", "figures"] });
      qc.invalidateQueries({ queryKey: ["admin", "overview"] });
      // The owned-items list joins the figure row, so cascading the
      // delete leaves it dangling here too — refetch so the collection
      // grid drops the ghost card.
      qc.invalidateQueries({ queryKey: ["owned"] });
    },
  });
}

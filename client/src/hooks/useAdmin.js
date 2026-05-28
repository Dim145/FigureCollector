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

// =============================================================================
// Figure types — admin curates the dropdown list (slugs + i18n labels + kanji).
// =============================================================================

/** Public list used by the figure-type dropdown anywhere in the app. Lives
 *  at /api/figure-types so any signed-in user can populate it without
 *  hitting an admin-only endpoint. */
export function useFigureTypes() {
  return useQuery({
    queryKey: ["figure-types"],
    queryFn: () => api.get("/figure-types"),
    // Types rarely change — cache aggressively. Mutations below explicitly
    // invalidate this so the admin sees their edit immediately.
    staleTime: 5 * 60_000,
  });
}

/** Admin-only list with the same payload as the public list — kept as a
 *  separate hook so the admin page can refetch independently when entering
 *  the admin nav, even when the public cache is still warm. */
export function useAdminFigureTypes() {
  return useQuery({
    queryKey: ["admin", "figure-types"],
    queryFn: () => api.get("/admin/figure-types"),
    staleTime: 10_000,
  });
}

/** How many figures still use this slug. The admin UI calls it before
 *  surfacing the delete confirm so the user knows what they're about to
 *  break. */
export function useFigureTypeUsage(id, { enabled = true } = {}) {
  return useQuery({
    queryKey: ["admin", "figure-types", id, "usage"],
    queryFn: () => api.get(`/admin/figure-types/${id}/usage`),
    enabled: enabled && !!id,
    staleTime: 30_000,
  });
}

export function useCreateFigureType() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload) => api.post("/admin/figure-types", payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["figure-types"] });
      qc.invalidateQueries({ queryKey: ["admin", "figure-types"] });
    },
  });
}

export function usePatchFigureType() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }) => api.patch(`/admin/figure-types/${id}`, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["figure-types"] });
      qc.invalidateQueries({ queryKey: ["admin", "figure-types"] });
    },
  });
}

export function useDeleteFigureType() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => api.delete(`/admin/figure-types/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["figure-types"] });
      qc.invalidateQueries({ queryKey: ["admin", "figure-types"] });
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

// =============================================================================
// Workers — gsplat compute registry. CUDA and Metal workers self-register on
// startup; the admin can rename, disable, or delete them here.
// =============================================================================

/** Live list — short stale so the online dots track reality without spamming. */
export function useAdminWorkers() {
  return useQuery({
    queryKey: ["admin", "workers"],
    queryFn: () => api.get("/admin/workers"),
    // Workers heartbeat every ~30 s; refetch enough to track that without
    // burning bandwidth when the admin is just looking.
    staleTime: 5_000,
    refetchInterval: 15_000,
  });
}

export function usePatchWorker() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }) => api.patch(`/admin/workers/${id}`, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "workers"] });
      // Disabling the last worker hides the "Modèle 3D" checkbox — bust
      // the capability cache too.
      qc.invalidateQueries({ queryKey: ["scans", "capabilities"] });
    },
  });
}

export function useDeleteWorker() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => api.delete(`/admin/workers/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "workers"] });
      qc.invalidateQueries({ queryKey: ["scans", "capabilities"] });
    },
  });
}

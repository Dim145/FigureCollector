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

// -------------------- settings (platform-wide policies) --------------------

/** Platform settings (currently the gsplat creation policy). Admin-only. */
export function useAdminSettings() {
  return useQuery({
    queryKey: ["admin", "settings"],
    queryFn: () => api.get("/admin/settings"),
    staleTime: 30_000,
  });
}

/** Patch one or more settings. Invalidates the admin settings cache AND the
 *  public scan-capabilities probe, since the gsplat creation policy feeds the
 *  "Modèle 3D" checkbox visibility for every user. */
export function useUpdateAdminSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch) => api.patch("/admin/settings", patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "settings"] });
      qc.invalidateQueries({ queryKey: ["scans", "capabilities"] });
      // The photo-search nav entry + page gate on this status.
      qc.invalidateQueries({ queryKey: ["visual-search", "status"] });
    },
  });
}

/** POST /admin/visual-search/reindex — queue every catalog image missing an
 *  embedding for the current model. The embed-capable worker drains the queue;
 *  returns `{ queued }`. */
export function useReindexVisualSearch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post("/admin/visual-search/reindex"),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["visual-search", "status"] });
    },
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

// =============================================================================
// Tasks / queue — the gsplat scan job queue (admin "Tâches" page).
// =============================================================================

/** Live task list. Admins don't receive the per-user scan WebSocket events, so
 *  we poll on a short interval to track 'processing' progress + state changes. */
export function useAdminScans() {
  return useQuery({
    queryKey: ["admin", "scans"],
    queryFn: () => api.get("/admin/scans"),
    staleTime: 3_000,
    refetchInterval: 6_000,
  });
}

export function useRetryScan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => api.post(`/admin/scans/${id}/retry`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "scans"] }),
  });
}

export function useFailScan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => api.post(`/admin/scans/${id}/fail`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "scans"] }),
  });
}

export function useDeleteScan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => api.delete(`/admin/scans/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "scans"] }),
  });
}

/** Server background-job runs (the in-process crons: release, cleanup, manga
 *  sync, price refresh) — merged into the Tasks page next to the worker scan
 *  queue. Same polling cadence as the scans so both halves stay in step. */
export function useAdminJobs() {
  return useQuery({
    queryKey: ["admin", "jobs"],
    queryFn: () => api.get("/admin/jobs"),
    staleTime: 3_000,
    refetchInterval: 6_000,
  });
}

/** Relaunch a failed server-job run — books a fresh `manual` run of the same
 *  job; the failed row stays in the history. */
export function useRetryJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => api.post(`/admin/jobs/${id}/retry`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "jobs"] }),
  });
}

// =============================================================================
// Entity bulk ops — unlink/move figures, delete with optional merge target.
//
// Same shape twice (series / characters) so the EntityPage admin toolbar and
// the AdminCatalogPage delete dialog share one hook per verb per entity kind.
// =============================================================================

/** Body shape: `{ figure_ids: [Uuid, …] }`. */
export function useUnlinkSeriesFigures() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ seriesId, figureIds }) =>
      api.post(`/admin/series/${seriesId}/figures/unlink`, {
        figure_ids: figureIds,
      }),
    onSuccess: (_d, vars) => {
      // The entity page reads `["entity", "series", slug]`; we don't have the
      // slug here (the page invalidates on slug change), so blanket-bust the
      // entity cache for any series page currently mounted.
      qc.invalidateQueries({ queryKey: ["entity", "series"] });
      qc.invalidateQueries({ queryKey: ["admin", "series", vars.seriesId] });
      qc.invalidateQueries({ queryKey: ["lookup", "series"] });
    },
  });
}

/** Body: `{ figure_ids, to_id }`. */
export function useMoveSeriesFigures() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ fromSeriesId, toSeriesId, figureIds }) =>
      api.post(`/admin/series/${fromSeriesId}/figures/move`, {
        figure_ids: figureIds,
        to_id: toSeriesId,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["entity", "series"] });
      qc.invalidateQueries({ queryKey: ["lookup", "series"] });
    },
  });
}

/** `replacementId` is optional — leaving it null deletes without merging. */
export function useDeleteSeries() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, replacementId }) => {
      const qs = replacementId ? `?replacement_id=${replacementId}` : "";
      return api.delete(`/admin/series/${id}${qs}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "series"] });
      qc.invalidateQueries({ queryKey: ["entity", "series"] });
      qc.invalidateQueries({ queryKey: ["lookup", "series"] });
    },
  });
}

export function useUnlinkCharacterFigures() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ characterId, figureIds }) =>
      api.post(`/admin/characters/${characterId}/figures/unlink`, {
        figure_ids: figureIds,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["entity", "character"] });
      qc.invalidateQueries({ queryKey: ["lookup", "characters"] });
    },
  });
}

export function useMoveCharacterFigures() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ fromCharacterId, toCharacterId, figureIds }) =>
      api.post(`/admin/characters/${fromCharacterId}/figures/move`, {
        figure_ids: figureIds,
        to_id: toCharacterId,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["entity", "character"] });
      qc.invalidateQueries({ queryKey: ["lookup", "characters"] });
    },
  });
}

export function useDeleteCharacter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, replacementId }) => {
      const qs = replacementId ? `?replacement_id=${replacementId}` : "";
      return api.delete(`/admin/characters/${id}${qs}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "characters"] });
      qc.invalidateQueries({ queryKey: ["entity", "character"] });
      qc.invalidateQueries({ queryKey: ["lookup", "characters"] });
    },
  });
}

// =============================================================================
// Bulk delete — multi-select + one POST per table. Every endpoint returns
// `{ deleted, skipped }`; the server enforces its own guards (users can't
// delete themselves or other admins, figure-types in use are skipped, …).
// Figure-types key on their STRING slug `id`; the rest on uuid `id`.
// =============================================================================

export function useBulkDeleteFigures() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids) => api.post("/admin/figures/bulk-delete", { ids }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["figures"] });
      qc.invalidateQueries({ queryKey: ["admin", "figures"] });
      qc.invalidateQueries({ queryKey: ["admin", "overview"] });
      qc.invalidateQueries({ queryKey: ["owned"] });
    },
  });
}

export function useBulkDeleteUsers() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids) => api.post("/admin/users/bulk-delete", { ids }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "users"] });
      qc.invalidateQueries({ queryKey: ["admin", "overview"] });
    },
  });
}

export function useBulkDeleteFigureTypes() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids) => api.post("/admin/figure-types/bulk-delete", { ids }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["figure-types"] });
      qc.invalidateQueries({ queryKey: ["admin", "figure-types"] });
    },
  });
}

export function useBulkDeleteStores() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids) => api.post("/admin/stores/bulk-delete", { ids }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["stores"] });
      qc.invalidateQueries({ queryKey: ["admin", "stores"] });
      qc.invalidateQueries({ queryKey: ["owned"] });
      qc.invalidateQueries({ queryKey: ["preorders"] });
    },
  });
}

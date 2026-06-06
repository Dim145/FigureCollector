import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api.js";

// =============================================================================
// Stores — promoted from a free-text column to a first-class entity.
//
// Lookup model: any user (admin or not) can implicitly create a new store by
// typing a name into the owned_item / preorder forms. The server's
// find_or_create resolves the name to a slug and either reuses the existing
// row or inserts a fresh one. Only admins can curate the metadata (URL,
// description, profile image) via the /admin/stores page.
// =============================================================================

/** Public list (any signed-in user). Used by the autocomplete component and
 *  the /admin/stores page. Cached aggressively because the list rarely
 *  changes outside admin sessions. */
export function useStores() {
  return useQuery({
    queryKey: ["stores"],
    queryFn: () => api.get("/stores"),
    staleTime: 5 * 60_000,
  });
}

/** Single store fetched by slug. Powers the /stores/:slug page hero. */
export function useStore(slug) {
  return useQuery({
    queryKey: ["store", slug],
    queryFn: () => api.get(`/stores/${slug}`),
    enabled: !!slug,
    staleTime: 60_000,
  });
}

/** Figures linked to this store via any owned_item or preorder. Backend
 *  already respects the user's NSFW preference. */
export function useStoreCatalog(slug) {
  return useQuery({
    queryKey: ["store", slug, "catalog"],
    queryFn: () => api.get(`/stores/${slug}/catalog`),
    enabled: !!slug,
  });
}

// ─── Admin ───────────────────────────────────────────────────────────────────

export function useAdminStores() {
  return useQuery({
    queryKey: ["admin", "stores"],
    queryFn: () => api.get("/admin/stores"),
    staleTime: 10_000,
  });
}

export function useStoreUsage(id, { enabled = true } = {}) {
  return useQuery({
    queryKey: ["admin", "stores", id, "usage"],
    queryFn: () => api.get(`/admin/stores/${id}/usage`),
    enabled: enabled && !!id,
    staleTime: 30_000,
  });
}

/** Invalidate every public + admin cache the mutation might affect. */
function invalidateAll(qc) {
  qc.invalidateQueries({ queryKey: ["stores"] });
  qc.invalidateQueries({ queryKey: ["admin", "stores"] });
  // Owned + preorders embed the store's resolved name + slug — when the
  // store row changes, those displays change too.
  qc.invalidateQueries({ queryKey: ["owned"] });
  qc.invalidateQueries({ queryKey: ["preorders"] });
  qc.invalidateQueries({ queryKey: ["preorder-for-owned"] });
}

export function useCreateStore() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload) => api.post("/admin/stores", payload),
    onSuccess: () => invalidateAll(qc),
  });
}

export function usePatchStore() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }) => api.patch(`/admin/stores/${id}`, patch),
    onSuccess: (_d, { id }) => {
      invalidateAll(qc);
      // Per-slug detail cache too — the slug may have changed via rename.
      qc.invalidateQueries({ queryKey: ["store"] });
      qc.invalidateQueries({ queryKey: ["admin", "stores", id] });
    },
  });
}

export function useDeleteStore() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => api.delete(`/admin/stores/${id}`),
    onSuccess: () => {
      invalidateAll(qc);
      qc.invalidateQueries({ queryKey: ["store"] });
    },
  });
}

// =============================================================================
// figure_stores M2M — link helpers
// =============================================================================

/** Stores linked to a figure. Public (any signed-in user). Powers the
 *  "Boutiques" button + popup on /figures/:id. */
export function useStoresForFigure(figureId) {
  return useQuery({
    queryKey: ["figure", figureId, "stores"],
    queryFn: () => api.get(`/figures/${figureId}/stores`),
    enabled: !!figureId,
    staleTime: 60_000,
  });
}

/** Admin: replace the full list of figures linked to a store. Used by the
 *  StorePage admin checkbox grid. Sends the whole next state in one PUT. */
export function useSetStoreFigures() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ storeId, figureIds }) =>
      api.put(`/admin/stores/${storeId}/figures`, { figure_ids: figureIds }),
    onSuccess: (_d, { storeId }) => {
      qc.invalidateQueries({ queryKey: ["store"] });
      qc.invalidateQueries({ queryKey: ["admin", "stores", storeId] });
      qc.invalidateQueries({ queryKey: ["figure"] });
    },
  });
}

/** Admin: link a figure to a store and/or set its buy link. Used from the
 *  FigureForm "Boutiques liées" section. `link` may be a full product URL or a
 *  bare `/path?query`; the server keeps only the path+query (null/empty
 *  clears it). Re-calling for an already-linked store edits its link. */
export function useAddFigureToStore() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ storeId, figureId, link = null }) =>
      api.post(`/admin/stores/${storeId}/figures/${figureId}`, { link }),
    onSuccess: (_d, { figureId }) => {
      qc.invalidateQueries({ queryKey: ["figure", figureId, "stores"] });
      qc.invalidateQueries({ queryKey: ["store"] });
    },
  });
}

/** Admin: remove a single figure from a store. The trigger may re-add
 *  the same pair on the next owned/preorder write. */
export function useRemoveFigureFromStore() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ storeId, figureId }) =>
      api.delete(`/admin/stores/${storeId}/figures/${figureId}`),
    onSuccess: (_d, { figureId }) => {
      qc.invalidateQueries({ queryKey: ["figure", figureId, "stores"] });
      qc.invalidateQueries({ queryKey: ["store"] });
    },
  });
}

/** Multipart upload — uses the same fetch-with-credentials pattern as the
 *  other entity photo uploads. */
export function useUploadStorePhoto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, file }) => {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/admin/stores/${id}/photo`, {
        method: "POST",
        body: fd,
        credentials: "include",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const err = new Error(body?.message ?? res.statusText);
        err.code = body?.error;
        err.status = res.status;
        throw err;
      }
      return res.json();
    },
    onSuccess: () => {
      invalidateAll(qc);
      qc.invalidateQueries({ queryKey: ["store"] });
    },
  });
}

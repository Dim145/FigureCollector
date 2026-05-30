import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api.js";

/**
 * Catalog-side photos for a figure. Distinct from `usePhotos(ownedId)`
 * which returns the signed-in user's personal photos of *their* copy.
 */
export function useFigurePhotos(figureId) {
  return useQuery({
    queryKey: ["figure-photos", figureId],
    queryFn: () => api.get(`/figures/${figureId}/photos`),
    enabled: !!figureId,
    staleTime: 60_000,
  });
}

/** Invalidate every catalog surface that embeds a figure's cover URL.
 *  Used by all three catalog-photo mutations because the catalog list
 *  (BrowsePage / CollectionPage) renders `primary_photo` from /api/figures
 *  — so any catalog-photo change must refresh that listing AND the
 *  single-figure detail endpoint, on top of the photo list itself. */
function invalidateFigureSurfaces(qc, figureId) {
  qc.invalidateQueries({ queryKey: ["figure-photos", figureId] });
  qc.invalidateQueries({ queryKey: ["figure", figureId] });
  qc.invalidateQueries({ queryKey: ["figures"] });
  // The owned-items list embeds the resolved catalog cover URL too.
  qc.invalidateQueries({ queryKey: ["owned"] });
}

export function useUploadFigurePhoto(figureId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (file) => {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/figures/${figureId}/photos`, {
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
    onSuccess: () => invalidateFigureSurfaces(qc, figureId),
  });
}

export function useReplaceFigurePhoto(figureId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ photoId, file }) => {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/figures/${figureId}/photos/${photoId}`, {
        method: "PUT",
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
    onSuccess: () => invalidateFigureSurfaces(qc, figureId),
  });
}

export function useSetPrimaryFigurePhoto(figureId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (photoId) =>
      api.patch(`/figures/${figureId}/photos/${photoId}`, { is_primary: true }),
    onSuccess: () => invalidateFigureSurfaces(qc, figureId),
  });
}

export function useDeleteFigurePhoto(figureId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (photoId) => api.delete(`/figures/${figureId}/photos/${photoId}`),
    onSuccess: () => invalidateFigureSurfaces(qc, figureId),
  });
}

/**
 * Pin (or clear) the cover photo/scan for one of the user's owned items.
 * Pass `{ photo_id }`, `{ scan_id }`, or `{ clear: true }`.
 */
export function useSetOwnedCover(ownedId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch) => api.patch(`/me/owned/${ownedId}/cover`, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["owned"] });
    },
  });
}

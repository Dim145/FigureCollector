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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["figure-photos", figureId] });
      // The owned-items list embeds the resolved catalog cover URL,
      // refresh it too.
      qc.invalidateQueries({ queryKey: ["owned"] });
    },
  });
}

export function useSetPrimaryFigurePhoto(figureId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (photoId) =>
      api.patch(`/figures/${figureId}/photos/${photoId}`, { is_primary: true }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["figure-photos", figureId] });
      qc.invalidateQueries({ queryKey: ["owned"] });
    },
  });
}

export function useDeleteFigurePhoto(figureId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (photoId) => api.delete(`/figures/${figureId}/photos/${photoId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["figure-photos", figureId] });
      qc.invalidateQueries({ queryKey: ["owned"] });
    },
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

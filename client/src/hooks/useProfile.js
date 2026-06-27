import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api.js";

export function usePublicProfile(slug) {
  return useQuery({
    queryKey: ["public-profile", slug],
    queryFn: () => api.get(`/u/${slug}`),
    enabled: !!slug,
    retry: false,
  });
}

export function useCompare(slug, { enabled = true } = {}) {
  return useQuery({
    queryKey: ["compare", slug],
    queryFn: () => api.get(`/compare/${slug}`),
    // The profile teaser passes `enabled: viewerCanCompare` so the (heavier)
    // diff only fires for an authed, non-self viewer; the cache it fills makes
    // the eventual /compare navigation instant.
    enabled: enabled && !!slug,
    retry: false,
  });
}

export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch) => api.patch("/me/profile", patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["me"] });
      qc.invalidateQueries({ queryKey: ["public-profile"] });
    },
  });
}

// ----- Photos ---------------------------------------------------------------

export function usePhotos(ownedId) {
  return useQuery({
    queryKey: ["photos", ownedId],
    queryFn: () => api.get(`/me/owned/${ownedId}/photos`),
    enabled: !!ownedId,
  });
}

export function useUploadPhoto(ownedId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (file) => {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/me/owned/${ownedId}/photos`, {
        method: "POST",
        body: fd,
        credentials: "include",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const err = new Error(body?.message ?? res.statusText);
        err.code = body?.error ?? `http_${res.status}`;
        err.status = res.status;
        throw err;
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["photos", ownedId] });
      // When the owned-item has no pinned cover yet, the collection card
      // falls through to "first personal photo" — refresh the owned list
      // so the new photo appears as the cover without a manual reload.
      qc.invalidateQueries({ queryKey: ["owned"] });
    },
  });
}

export function useReplacePhoto(ownedId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ photoId, file }) => {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/me/owned/${ownedId}/photos/${photoId}`, {
        method: "PUT",
        body: fd,
        credentials: "include",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const err = new Error(body?.message ?? res.statusText);
        err.code = body?.error ?? `http_${res.status}`;
        err.status = res.status;
        throw err;
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["photos", ownedId] });
      qc.invalidateQueries({ queryKey: ["owned"] });
    },
  });
}

export function useDeletePhoto(ownedId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (photoId) => api.delete(`/me/owned/${ownedId}/photos/${photoId}`),
    onSuccess: () => {
      // Deleting a photo can change the cover (the SPA falls back to the
      // catalog image when the user's pinned cover vanishes). Invalidate
      // both the per-item photo list AND the parent owned collection so
      // the grid tile picks up the new cover without a manual refresh.
      qc.invalidateQueries({ queryKey: ["photos", ownedId] });
      qc.invalidateQueries({ queryKey: ["owned"] });
      // The removed photo's tags may have been the only source of a facet tag.
      qc.invalidateQueries({ queryKey: ["owned-photo-tags"] });
    },
  });
}

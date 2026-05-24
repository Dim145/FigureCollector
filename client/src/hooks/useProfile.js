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

export function useCompare(slug) {
  return useQuery({
    queryKey: ["compare", slug],
    queryFn: () => api.get(`/compare/${slug}`),
    enabled: !!slug,
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ["photos", ownedId] }),
  });
}

export function useDeletePhoto(ownedId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (photoId) => api.delete(`/me/owned/${ownedId}/photos/${photoId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["photos", ownedId] }),
  });
}

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api.js";

export function useScans(ownedId) {
  return useQuery({
    queryKey: ["scans", ownedId],
    queryFn: () => api.get(`/me/owned/${ownedId}/scans`),
    enabled: !!ownedId,
  });
}

/**
 * Upload N frames as a single multipart request.
 *
 * @param {string} ownedId
 * @returns mutation expecting `{ frames: Blob[], kind?: string }`
 */
export function useCreateScan(ownedId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ frames, kind = "turntable" }) => {
      if (!frames || frames.length < 6) {
        throw new Error("at least 6 frames required");
      }
      const fd = new FormData();
      fd.append("kind", kind);
      frames.forEach((blob, i) => {
        fd.append("frame", blob, `frame_${String(i).padStart(3, "0")}.webp`);
      });
      const res = await fetch(`/api/me/owned/${ownedId}/scans`, {
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ["scans", ownedId] }),
  });
}

export function useDeleteScan(ownedId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (scanId) => api.delete(`/me/owned/${ownedId}/scans/${scanId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["scans", ownedId] }),
  });
}

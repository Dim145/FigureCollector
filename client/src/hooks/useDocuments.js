import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api.js";

/** Proof-of-purchase documents (receipts/invoices) attached to an owned item.
 *  Private to the owner; the list excludes the storage key. */
export function useOwnedDocuments(ownedId) {
  return useQuery({
    queryKey: ["documents", ownedId],
    queryFn: () => api.get(`/me/owned/${ownedId}/documents`),
    enabled: !!ownedId,
  });
}

/** Upload a document (PDF / JPG / PNG / WebP, ≤ 10 MB). Raw `fetch` because the
 *  shared api client JSON-encodes bodies — multipart needs the native FormData
 *  path (same as the photo upload). */
export function useUploadDocument(ownedId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (file) => {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/me/owned/${ownedId}/documents`, {
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ["documents", ownedId] }),
  });
}

export function useDeleteDocument(ownedId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (docId) => api.delete(`/me/owned/${ownedId}/documents/${docId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["documents", ownedId] }),
  });
}

/** Parse a justificatif (Palier 1: PDF text-layer extraction + heuristics, no
 *  OCR/cloud). Resolves to `{ extracted, note, rollup }`. Stores the per-doc
 *  metadata server-side; it never writes the owned item — applying the
 *  suggestions is a separate, explicit patch. */
export function useParseDocument(ownedId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (docId) =>
      api.post(`/me/owned/${ownedId}/documents/${docId}/parse`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["documents", ownedId] }),
  });
}

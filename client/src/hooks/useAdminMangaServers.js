import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api.js";

// ── Admin: MangaCollector server registry (Lot 8b) ───────────────────────────
//
// The admin curates the allow-list of MangaCollector origins users may link to.
// Rows arrive `pending` (user-submitted); the admin approves / revokes / relabels
// / deletes. Approving or revoking notifies every user linked to that server.

const KEY = ["admin", "manga-servers"];

/** Full registry (pending → approved → revoked), each row with submitter /
 *  reviewer usernames + the count of users currently pointing at it. */
export function useAdminMangaServers() {
  return useQuery({
    queryKey: KEY,
    queryFn: () => api.get("/admin/manga-servers"),
    staleTime: 10_000,
  });
}

/** Invalidate the admin list + the public picker + every user's own link
 *  status (a flip from pending→approved activates their integration). */
function invalidateAll(qc) {
  qc.invalidateQueries({ queryKey: KEY });
  qc.invalidateQueries({ queryKey: ["manga-servers"] });
  qc.invalidateQueries({ queryKey: ["manga-link"] });
}

export function useApproveMangaServer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => api.post(`/admin/manga-servers/${id}/approve`),
    onSuccess: () => invalidateAll(qc),
  });
}

export function useRevokeMangaServer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, note }) =>
      api.post(`/admin/manga-servers/${id}/revoke`, { note: note || null }),
    onSuccess: () => invalidateAll(qc),
  });
}

export function usePatchMangaServer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, label }) =>
      api.patch(`/admin/manga-servers/${id}`, { label: label ?? null }),
    onSuccess: () => invalidateAll(qc),
  });
}

export function useDeleteMangaServer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => api.delete(`/admin/manga-servers/${id}`),
    onSuccess: () => invalidateAll(qc),
  });
}

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api.js";

/** Whether an admin has left the MCP endpoint open, plus the canonical scope
 *  list (served by the API so the panel and the server can't drift on it). */
export function useMcpStatus() {
  return useQuery({
    queryKey: ["mcp", "status"],
    queryFn: () => api.get("/mcp/status"),
    staleTime: 60_000,
  });
}

/** This user's live API keys — never the secrets, which exist only in the
 *  create response. */
export function useApiKeys() {
  return useQuery({
    queryKey: ["mcp", "keys"],
    queryFn: () => api.get("/me/api-keys"),
  });
}

/** Mint a key. The resolved value carries `token`, the ONE time the secret is
 *  ever returned — the caller must show it before it's gone. */
export function useCreateApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) => api.post("/me/api-keys", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["mcp", "keys"] }),
  });
}

export function useRevokeApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => api.delete(`/me/api-keys/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["mcp", "keys"] });
      qc.invalidateQueries({ queryKey: ["mcp", "activity"] });
    },
  });
}

/** What agents have done with those keys, newest first. */
export function useMcpActivity(limit = 30) {
  return useQuery({
    queryKey: ["mcp", "activity", limit],
    queryFn: () => api.get(`/me/mcp/activity?limit=${limit}`),
    staleTime: 15_000,
  });
}

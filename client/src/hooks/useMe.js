import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api.js";

/** Read the current session. Returns `{ authenticated: false }` when not signed in. */
export function useMe() {
  return useQuery({
    queryKey: ["me"],
    queryFn: () => api.get("/me"),
    staleTime: Infinity,
    retry: false,
  });
}

/** POST /api/auth/login. On success, refresh `useMe`. */
export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload) => api.post("/auth/login", payload),
    onSuccess: (data) => {
      qc.setQueryData(["me"], { authenticated: true, user: data.user });
    },
  });
}

/** POST /api/auth/register. */
export function useRegister() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload) => api.post("/auth/register", payload),
    onSuccess: (data) => {
      qc.setQueryData(["me"], { authenticated: true, user: data.user });
    },
  });
}

/** POST /api/auth/logout. */
export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post("/auth/logout"),
    onSuccess: () => {
      qc.setQueryData(["me"], { authenticated: false });
      qc.clear();
    },
  });
}

/** GET /api/auth/providers — used by LoginPage to decide which buttons to render. */
export function useAuthProviders() {
  return useQuery({
    queryKey: ["auth", "providers"],
    queryFn: () => api.get("/auth/providers"),
    staleTime: Infinity,
  });
}

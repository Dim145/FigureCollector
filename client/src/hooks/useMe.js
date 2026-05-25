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

/** The currency every price input should default to. Reads the user's
 *  `preferred_currency` setting, falling back to JPY when none is set
 *  (which matches the hard-coded baseline the server still uses for new
 *  rows that don't specify one). */
export function useDefaultCurrency() {
  const me = useMe();
  return me.data?.user?.preferred_currency ?? "JPY";
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

/** Convenience: true iff the signed-in user has the admin flag set. */
export function useIsAdmin() {
  const me = useMe();
  return !!me.data?.user?.is_admin;
}

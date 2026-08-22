import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api.js";
import { purgeLocalData } from "../lib/db.js";

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
      // Clear any cached data left by a previous account on this device before
      // seeding the new session. Query keys aren't user-scoped, so without this
      // a fast account switch (without an intervening logout/reload) could
      // briefly serve the previous user's cached collection/stats to the new one.
      qc.clear();
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
      // Clear any cached data left by a previous account on this device before
      // seeding the new session. Query keys aren't user-scoped, so without this
      // a fast account switch (without an intervening logout/reload) could
      // briefly serve the previous user's cached collection/stats to the new one.
      qc.clear();
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
      // Purge the service-worker caches holding authenticated, per-user
      // responses — private photo bytes (fc-photos) especially. qc.clear()
      // only drops the in-memory TanStack cache; Cache Storage survives logout
      // and a later user on a shared device could otherwise read it. Best-effort.
      // Same reasoning for the Dexie mirror + outbox: they hold what you own
      // and what you were about to buy, on the device.
      purgeLocalData();
      if (typeof caches !== "undefined") {
        for (const name of ["fc-photos", "fc-figures", "fc-external"]) {
          caches.delete(name).catch(() => {});
        }
      }
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

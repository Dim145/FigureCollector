import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api.js";

/**
 * GET /api/me/calendar — the user's private iCal feed: { token, feed_path }.
 * The server mints the token lazily on first call, so gate with `enabled` to
 * avoid minting one until the user actually opens the subscribe panel.
 */
export function useCalendarFeed({ enabled = true } = {}) {
  return useQuery({
    queryKey: ["calendar-feed"],
    queryFn: () => api.get("/me/calendar"),
    enabled,
    staleTime: Infinity, // the token is stable until explicitly rotated
    retry: false,
  });
}

/** POST /api/me/calendar/rotate — revoke the current link, mint a fresh one. */
export function useRotateCalendarFeed() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post("/me/calendar/rotate"),
    onSuccess: (data) => qc.setQueryData(["calendar-feed"], data),
  });
}

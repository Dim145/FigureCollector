import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api.js";

/**
 * Social graph (Lot 4) — same-instance follow/unfollow + discovery + lists.
 * Follow mutations invalidate every surface that shows a relationship or a
 * count so buttons, "vous suit" hints, and counters stay in sync after a tap.
 */

export function useDiscover(q) {
  const query = (q ?? "").trim();
  return useQuery({
    queryKey: ["collectors", query],
    queryFn: () =>
      api.get(`/collectors${query ? `?q=${encodeURIComponent(query)}` : ""}`),
  });
}

export function useFollowers(slug, enabled = true) {
  return useQuery({
    queryKey: ["followers", slug],
    queryFn: () => api.get(`/u/${slug}/followers`),
    enabled: !!slug && enabled,
  });
}

export function useFollowing(slug, enabled = true) {
  return useQuery({
    queryKey: ["following", slug],
    queryFn: () => api.get(`/u/${slug}/following`),
    enabled: !!slug && enabled,
  });
}

function useFollowMutation(kind) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (username) =>
      kind === "follow"
        ? api.post(`/me/follows/${encodeURIComponent(username)}`)
        : api.delete(`/me/follows/${encodeURIComponent(username)}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["collectors"] });
      qc.invalidateQueries({ queryKey: ["public-profile"] });
      qc.invalidateQueries({ queryKey: ["followers"] });
      qc.invalidateQueries({ queryKey: ["following"] });
    },
  });
}

export function useFollow() {
  return useFollowMutation("follow");
}

export function useUnfollow() {
  return useFollowMutation("unfollow");
}

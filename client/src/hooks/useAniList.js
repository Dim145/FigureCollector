import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api.js";

/** Search AniList media (anime + manga) by free-text. Debounce upstream. */
export function useAniListSearch(query) {
  const q = (query ?? "").trim();
  const enabled = q.length >= 2;
  return useQuery({
    queryKey: ["anilist", "search", q],
    queryFn: () => api.get(`/external/anilist/search?q=${encodeURIComponent(q)}`),
    enabled,
    staleTime: 60_000,
  });
}

export function useAniListMedia(id) {
  return useQuery({
    queryKey: ["anilist", "media", id],
    queryFn: () => api.get(`/external/anilist/${id}`),
    enabled: !!id,
    staleTime: 60 * 60_000,
  });
}

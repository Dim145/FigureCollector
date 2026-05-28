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

/**
 * Search AniList characters, optionally scoped to a series (`mediaId` =
 * the picked series' AniList id).
 *
 *   - scoped (mediaId set): enabled even with an empty query — the backend
 *     returns the series' character roster, which we filter as the user types.
 *   - free (no mediaId): needs ≥2 chars, like the media search.
 */
export function useAniListCharacterSearch(query, mediaId) {
  const q = (query ?? "").trim();
  const hasMedia = mediaId != null && mediaId !== "";
  const enabled = hasMedia || q.length >= 2;
  return useQuery({
    queryKey: ["anilist", "char-search", q, hasMedia ? mediaId : null],
    queryFn: () => {
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      if (hasMedia) params.set("media_id", String(mediaId));
      return api.get(`/external/anilist/characters?${params.toString()}`);
    },
    enabled,
    staleTime: 60_000,
  });
}

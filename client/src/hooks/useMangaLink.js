import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api.js";

// ── MangaCollector synergy (Lot 8) ───────────────────────────────────────────
//
// The manga link is SERVER-side config (not a localStorage pref): FigureCollector
// stores the user's MangaCollector instance URL + public slug, then reads their
// public manga library server-side (cached, behind the SSRF guard) to relate the
// two worlds via the series' shared `mal_id`.

const KEY = ["manga-link"];

/** The signed-in user's manga link state:
 *  `{ connected, base_url, slug, profile: { display_name, series_count,
 *  volumes_owned } | null }`. */
export function useMangaLink() {
  return useQuery({
    queryKey: KEY,
    queryFn: () => api.get("/me/manga-link"),
  });
}

/** Connect / test a link. Body `{ base_url, slug }` → `{ connected, profile }`.
 *  Server rejects with 400 (bad/empty/disallowed URL) or 503 (unreachable);
 *  the caller branches on `err.status` to show "couldn't connect". */
export function useSetMangaLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ base_url, slug }) =>
      api.put("/me/manga-link", { base_url, slug }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY });
      qc.invalidateQueries({ queryKey: ["manga-crossings"] });
      qc.invalidateQueries({ queryKey: ["manga-figure"] });
    },
  });
}

/** Unlink — forgets the instance/slug and drops the cached library. */
export function useClearMangaLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.delete("/me/manga-link"),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY });
      qc.invalidateQueries({ queryKey: ["manga-crossings"] });
      qc.invalidateQueries({ queryKey: ["manga-figure"] });
    },
  });
}

/** The two cross-link lists for /croisements:
 *  `{ dual: [...], reading: [...] }`. Only fetched once a link exists. */
export function useCrossings(connected) {
  return useQuery({
    queryKey: ["manga-crossings"],
    queryFn: () => api.get("/me/manga-link/crossings"),
    enabled: !!connected,
  });
}

/** Per-figure manga match for the detail-page badge:
 *  `{ in_library, name, read_percent, volumes_owned, volumes, fully_read }`.
 *  Cheap + harmless when unlinked (returns `{ in_library:false }`), so it's
 *  gated on having a figureId rather than on the connected state — but we still
 *  pass `connected` through so an unlinked user makes no request at all. */
export function useFigureManga(figureId, connected) {
  return useQuery({
    queryKey: ["manga-figure", figureId],
    queryFn: () => api.get(`/me/manga-link/figure/${figureId}`),
    enabled: !!figureId && !!connected,
    staleTime: 5 * 60_000,
  });
}

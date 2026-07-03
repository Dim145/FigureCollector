import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api.js";
import { safeHref } from "../lib/safeUrl.js";

// ── MangaCollector synergy (Lot 8 + 8b) ──────────────────────────────────────
//
// The manga link is SERVER-side config. A link is `(manga_server_id, slug)`,
// where the server comes from an ADMIN-CURATED registry: a user picks an
// `approved` server or submits a new one (→ `pending`, inert until an admin
// approves it). Crossings / badges only resolve when the linked server's status
// is `approved`; `pending` / `revoked` keep the link but disable the features.

const KEY = ["manga-link"];

/** The signed-in user's link state:
 *  `{ connected, status: 'pending'|'approved'|'revoked'|null,
 *     server: { id, base_url, label } | null, slug,
 *     profile: { display_name, series_count, volumes_owned } | null,
 *     revoked_reason? }`. */
export function useMangaLink({ enabled = true } = {}) {
  return useQuery({
    queryKey: KEY,
    queryFn: () => api.get("/me/manga-link"),
    // `/me/manga-link` is owner-only — on public pages (e.g. an anonymously
    // viewed series page) callers pass `enabled: authenticated` so we don't
    // fire a guaranteed-401 request.
    enabled,
  });
}

/** The admin-approved servers a user can pick from when linking. */
export function useApprovedServers() {
  return useQuery({
    queryKey: ["manga-servers"],
    queryFn: () => api.get("/manga-servers"),
    staleTime: 60_000,
  });
}

/** Connect / switch the link. Body is `{ server_id, slug }` (pick an approved
 *  server) OR `{ new_base_url, slug }` (submit a new one → lands pending).
 *  Returns `{ connected, status, profile }`. The server rejects with 400
 *  (bad/disallowed URL, revoked server, missing slug), 404 (unknown server),
 *  or 503 (approved instance unreachable). */
export function useSetMangaLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) => api.put("/me/manga-link", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY });
      qc.invalidateQueries({ queryKey: ["manga-crossings"] });
      qc.invalidateQueries({ queryKey: ["manga-figure"] });
      qc.invalidateQueries({ queryKey: ["manga-series"] });
    },
  });
}

/** Resync — re-fetches the linked MangaCollector library and recomputes
 *  crossings. No body; a 2xx (e.g. `{ backfilled }`) is success. Only meaningful
 *  on an `approved` link. Refreshes the link state (the library tally) and the
 *  crossings list. */
export function useSyncMangaLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post("/me/manga-link/sync"),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY });
      qc.invalidateQueries({ queryKey: ["manga-crossings"] });
      qc.invalidateQueries({ queryKey: ["manga-figure"] });
      qc.invalidateQueries({ queryKey: ["manga-series"] });
    },
  });
}

/** Unlink — forgets the server + slug and drops the cached library. */
export function useClearMangaLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.delete("/me/manga-link"),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY });
      qc.invalidateQueries({ queryKey: ["manga-crossings"] });
      qc.invalidateQueries({ queryKey: ["manga-figure"] });
      qc.invalidateQueries({ queryKey: ["manga-series"] });
    },
  });
}

/** The two cross-link lists for /croisements. Only fetched once the link is
 *  ACTIVE (the linked server is approved) — pending/revoked return empty
 *  server-side anyway, so we don't even ask. */
export function useCrossings(active) {
  return useQuery({
    queryKey: ["manga-crossings"],
    queryFn: () => api.get("/me/manga-link/crossings"),
    enabled: !!active,
  });
}

/** Per-figure manga match for the detail-page badge. Gated on `active` (the
 *  linked server is approved) so a pending/revoked link makes no request. */
export function useFigureManga(figureId, active) {
  return useQuery({
    queryKey: ["manga-figure", figureId],
    queryFn: () => api.get(`/me/manga-link/figure/${figureId}`),
    enabled: !!figureId && !!active,
    staleTime: 5 * 60_000,
  });
}

/** Per-series manga match for the series-page "open in MangaCollector" button.
 *  Gated on `active` (the linked server is approved) so a pending/revoked/absent
 *  link makes no request. Returns `{ in_library, mal_id? }`. */
export function useSeriesManga(seriesId, active) {
  return useQuery({
    queryKey: ["manga-series", seriesId],
    queryFn: () => api.get(`/me/manga-link/series/${seriesId}`),
    enabled: !!seriesId && !!active,
    staleTime: 5 * 60_000,
  });
}

/** Deep-link to a manga's page on the linked MangaCollector instance.
 *  MangaCollector resolves a manga by its MyAnimeList id at `/mangapage?mal_id=`,
 *  matched against the signed-in user's own library. Returns `null` when the
 *  base or id is missing, or when `safeHref` rejects a poisoned `base_url`
 *  (non-http(s) scheme). */
export function mangaPageHref(base, malId) {
  if (!base || malId == null) return null;
  const root = String(base).replace(/\/+$/, "");
  return safeHref(`${root}/mangapage?mal_id=${encodeURIComponent(malId)}`);
}

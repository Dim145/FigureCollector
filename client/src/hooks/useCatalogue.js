import { useCallback, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api.js";

/**
 * GET /api/catalogue/facets — aggregated catalogue facets with counts, busiest
 * first. Powers the left facet rail (Fabricant / Série / Personnage / Échelle /
 * Tags), the discovery explore-by-maker bento, AND the "popular" search proxy
 * (derived in-component from series + characters + tags).
 *
 * Public + NSFW-aware via the session, like `/figures` and `/figures/tags`.
 * Rarely changes → long stale time. Fails closed (retry:false) so the page
 * still renders without facets if the endpoint is unavailable.
 *
 * Shape:
 *   {
 *     manufacturers: [{ id, slug, name, count }],
 *     series:        [{ id, slug, name, count }],
 *     characters:    [{ id, slug, name, count }],
 *     scales:        [{ value, count }],
 *     types:         [{ id, count }],
 *     tags:          [{ tag, count }],
 *   }
 */
export function useCatalogueFacets(options = {}) {
  return useQuery({
    queryKey: ["catalogue", "facets"],
    queryFn: () => api.get("/catalogue/facets"),
    staleTime: 5 * 60 * 1000,
    retry: false,
    ...options,
  });
}

/**
 * GET /api/catalogue/discover — the three curated discovery rails. Auth-only
 * (the favourite-studios rail is per-viewer), so the caller gates it on the
 * signed-in flag via `options.enabled`.
 *
 * Shape (Figure = the SAME DTO `/figures` returns, so FigureCard renders it
 * identically):
 *   {
 *     recently_added:     [Figure],
 *     upcoming_preorders: [Figure],
 *     favorite_studios: { makers: [{ name, slug, count }], figures: [Figure] },
 *   }
 */
export function useCatalogueDiscover(options = {}) {
  return useQuery({
    queryKey: ["catalogue", "discover"],
    queryFn: () => api.get("/catalogue/discover"),
    staleTime: 5 * 60 * 1000,
    retry: false,
    ...options,
  });
}

const RECENT_KEY = "fc.catalogue.recent-searches";
const RECENT_CAP = 8;

function readRecent() {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((s) => typeof s === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Recent catalogue searches, persisted in localStorage (no backend — a locked
 * product decision). Most-recent-first, deduped (case-insensitive), capped at
 * ~8. `push` is called on an actual search submit; `clear` wipes the list.
 *
 * Reads lazily on mount and keeps an in-memory mirror so the autocomplete
 * re-renders immediately after a push without a storage round-trip.
 */
export function useRecentSearches() {
  const [recent, setRecent] = useState(readRecent);

  const push = useCallback((raw) => {
    const term = String(raw ?? "").trim();
    if (!term) return;
    setRecent((prev) => {
      const next = [term, ...prev.filter((s) => s.toLowerCase() !== term.toLowerCase())].slice(
        0,
        RECENT_CAP,
      );
      try {
        localStorage.setItem(RECENT_KEY, JSON.stringify(next));
      } catch {
        /* private mode / quota — keep the in-memory copy */
      }
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    setRecent([]);
    try {
      localStorage.removeItem(RECENT_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  return { recent, push, clear };
}

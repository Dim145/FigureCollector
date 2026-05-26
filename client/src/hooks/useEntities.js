import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api.js";

// =============================================================================
// Lightweight entity lookups — used by the figure-form autocomplete fields.
//
// The full series / character objects (with figure_count, anilist enrichment,
// covers, …) live behind `/admin/...` and aren't needed for typing-time
// suggestions. These hooks hit the public `/series` and `/characters` lookup
// endpoints which return just `{id, name, slug}` plus the joined series name
// for character disambiguation.
//
// Cache: 5 minutes — the catalogue evolves only when a user adds a figure
// (rare relative to keystroke filtering).
// =============================================================================

export function useSeriesLookup() {
  return useQuery({
    queryKey: ["lookup", "series"],
    queryFn: () => api.get("/series"),
    staleTime: 5 * 60_000,
  });
}

export function useCharactersLookup() {
  return useQuery({
    queryKey: ["lookup", "characters"],
    queryFn: () => api.get("/characters"),
    staleTime: 5 * 60_000,
  });
}

export function useManufacturersLookup() {
  return useQuery({
    queryKey: ["lookup", "manufacturers"],
    queryFn: () => api.get("/manufacturers"),
    staleTime: 5 * 60_000,
  });
}

export function useSculptorsLookup() {
  return useQuery({
    queryKey: ["lookup", "sculptors"],
    queryFn: () => api.get("/sculptors"),
    staleTime: 5 * 60_000,
  });
}

/** Distinct list of materials already used across all figures. The
 *  endpoint returns plain strings (`["PVC", "ABS", …]`); we wrap them
 *  client-side into `{ name }` objects so the same EntityAutocomplete
 *  component handles them with no special-casing. */
export function useMaterialsLookup() {
  return useQuery({
    queryKey: ["lookup", "materials"],
    queryFn: async () => {
      const raw = await api.get("/materials");
      return Array.isArray(raw) ? raw.map((name) => ({ name })) : [];
    },
    staleTime: 5 * 60_000,
  });
}

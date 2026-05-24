import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api.js";

export function useActivity({ limit = 50, offset = 0 } = {}) {
  return useQuery({
    queryKey: ["activity", limit, offset],
    queryFn: () =>
      api.get(`/me/activity?limit=${limit}&offset=${offset}`),
  });
}

export function useYearInReview(year) {
  return useQuery({
    queryKey: ["year-in-review", year],
    queryFn: () => api.get(`/me/year-in-review/${year}`),
    enabled: Number.isFinite(year),
    staleTime: 60_000,
  });
}

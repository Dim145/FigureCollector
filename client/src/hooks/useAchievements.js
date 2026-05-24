import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api.js";

/** Public catalog of every achievement (no auth required). */
export function useAchievementsCatalog() {
  return useQuery({
    queryKey: ["achievements", "catalog"],
    queryFn: () => api.get("/achievements"),
    staleTime: 24 * 60 * 60 * 1000,
  });
}

/** Achievements the current user has unlocked. */
export function useMyAchievements() {
  return useQuery({
    queryKey: ["me", "achievements"],
    queryFn: () => api.get("/me/achievements"),
  });
}

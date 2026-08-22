import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api.js";

/** Dated condition reports (+ their defects) for one owned piece. */
export function useConditionReports(ownedId) {
  return useQuery({
    queryKey: ["condition-reports", ownedId],
    queryFn: () => api.get(`/me/owned/${ownedId}/condition-reports`),
    enabled: !!ownedId,
  });
}

function useInvalidate(ownedId) {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ["condition-reports", ownedId] });
}

export function useCreateConditionReport(ownedId) {
  const done = useInvalidate(ownedId);
  return useMutation({
    mutationFn: (payload) => api.post(`/me/owned/${ownedId}/condition-reports`, payload),
    onSuccess: done,
  });
}

export function usePatchConditionReport(ownedId) {
  const done = useInvalidate(ownedId);
  return useMutation({
    mutationFn: ({ id, patch }) => api.patch(`/me/condition-reports/${id}`, patch),
    onSuccess: done,
  });
}

export function useDeleteConditionReport(ownedId) {
  const done = useInvalidate(ownedId);
  return useMutation({
    mutationFn: (id) => api.delete(`/me/condition-reports/${id}`),
    onSuccess: done,
  });
}

export function useAddDefect(ownedId) {
  const done = useInvalidate(ownedId);
  return useMutation({
    mutationFn: ({ reportId, defect }) =>
      api.post(`/me/condition-reports/${reportId}/defects`, defect),
    onSuccess: done,
  });
}

export function useResolveDefect(ownedId) {
  const done = useInvalidate(ownedId);
  return useMutation({
    mutationFn: ({ id, resolved_on }) =>
      api.patch(`/me/condition-defects/${id}`, { resolved_on }),
    onSuccess: done,
  });
}

export function useDeleteDefect(ownedId) {
  const done = useInvalidate(ownedId);
  return useMutation({
    mutationFn: (id) => api.delete(`/me/condition-defects/${id}`),
    onSuccess: done,
  });
}

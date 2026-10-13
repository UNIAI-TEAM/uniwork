"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as privacy from "../api/endpoints/privacy";

export const privacyKeys = {
  exports: (orgId: string) => ["privacy", orgId, "exports"] as const,
};

/**
 * Export jobs. The list refetches while one is running: the zip is built on a
 * worker, so the screen that requested it has nothing else to wait on.
 */
export function usePrivacyExports(orgId: string) {
  return useQuery({
    queryKey: privacyKeys.exports(orgId),
    queryFn: () => privacy.listPrivacyExports(orgId),
    enabled: !!orgId,
    refetchInterval: (query) => {
      const running = query.state.data?.some((e) => e.status === "pending" || e.status === "running");
      return running ? 3000 : false;
    },
  });
}

export function useCreatePrivacyExport(orgId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => privacy.createPrivacyExport(orgId),
    onSuccess: () => qc.invalidateQueries({ queryKey: privacyKeys.exports(orgId) }),
  });
}

export function useCreatePrivacyDeletion(orgId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (confirmSlug: string) => privacy.createPrivacyDeletion(orgId, confirmSlug),
    onSuccess: () => qc.invalidateQueries({ queryKey: privacyKeys.exports(orgId) }),
  });
}

export function useCancelPrivacyDeletion(orgId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => privacy.cancelPrivacyDeletion(orgId),
    onSuccess: () => qc.invalidateQueries({ queryKey: privacyKeys.exports(orgId) }),
  });
}

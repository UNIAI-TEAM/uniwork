"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as api from "../api/endpoints/ai-office";
import type { SaveAiCredentialInput } from "../types/ai-office";

export { byokProxyBaseUrl } from "../api/endpoints/ai-office";

/** Every key carries the organization id: these routes are org-scoped. */
export const aiOfficeKeys = {
  all: ["ai-office"] as const,
  credentials: (orgId: string) => ["ai-office", "credentials", orgId] as const,
  cloud: (orgId: string) => ["ai-office", "cloud", orgId] as const,
};

export function useAiCredentials(orgId: string, enabled = true) {
  return useQuery({
    queryKey: aiOfficeKeys.credentials(orgId),
    queryFn: () => api.listAiCredentials(orgId),
    enabled: enabled && !!orgId,
  });
}

/** Not optimistic: the server validates the key and the base URL. */
export function useSaveAiCredential(orgId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { provider: string; body: SaveAiCredentialInput }) =>
      api.saveAiCredential(orgId, vars.provider, vars.body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: aiOfficeKeys.credentials(orgId) });
    },
  });
}

export function useDeleteAiCredential(orgId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (provider: string) => api.deleteAiCredential(orgId, provider),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: aiOfficeKeys.credentials(orgId) });
    },
  });
}

/** Entitlement + tool availability + credits in one read; credits move on every call. */
export function useAiCloudStatus(orgId: string, enabled = true) {
  return useQuery({
    queryKey: aiOfficeKeys.cloud(orgId),
    queryFn: () => api.getAiCloudStatus(orgId),
    enabled: enabled && !!orgId,
    staleTime: 60_000,
  });
}

/** Cloud calls spend `ai.tokens`, so each success refetches the credits line. */
function useCloudMutation<I, O>(orgId: string, fn: (orgId: string, body: I) => Promise<O>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: I) => fn(orgId, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: aiOfficeKeys.cloud(orgId) });
    },
  });
}

export function useAiCloudSearch(orgId: string) {
  return useCloudMutation(orgId, api.aiCloudSearch);
}

export function useAiCloudGenerateImage(orgId: string) {
  return useCloudMutation(orgId, api.aiCloudGenerateImage);
}

export function useAiCloudAnalyzeMedia(orgId: string) {
  return useCloudMutation(orgId, api.aiCloudAnalyzeMedia);
}

export function useAiCloudTranscribe(orgId: string) {
  return useCloudMutation(orgId, api.aiCloudTranscribe);
}

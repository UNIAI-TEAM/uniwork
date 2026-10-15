"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as connect from "../api/endpoints/connect";
import type { ConnectedApp, ConnectedAppList, McpPolicy } from "../api/endpoints/connect";

export const connectKeys = {
  all: () => ["connect"] as const,
  mine: () => [...connectKeys.all(), "mine"] as const,
  org: (orgSlug: string) => [...connectKeys.all(), "org", orgSlug] as const,
  policy: (orgSlug: string) => [...connectKeys.all(), "policy", orgSlug] as const,
};

export function useMyConnectedApps(opts?: { enabled?: boolean }) {
  return useQuery<ConnectedAppList>({
    queryKey: connectKeys.mine(),
    queryFn: connect.listMyConnectedApps,
    enabled: opts?.enabled ?? true,
  });
}

export function useRevokeMyConnectedApp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => connect.revokeMyConnectedApp(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: connectKeys.mine() }),
  });
}

export function useOrgConnectedApps(orgSlug: string, opts?: { enabled?: boolean }) {
  return useQuery<ConnectedApp[]>({
    queryKey: connectKeys.org(orgSlug),
    queryFn: () => connect.listOrgConnectedApps(orgSlug),
    enabled: (opts?.enabled ?? true) && !!orgSlug,
  });
}

export function useRevokeOrgConnectedApp(orgSlug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => connect.revokeOrgConnectedApp(orgSlug, id),
    onSuccess: () => Promise.all([
      qc.invalidateQueries({ queryKey: connectKeys.org(orgSlug) }),
      qc.invalidateQueries({ queryKey: connectKeys.mine() }),
    ]),
  });
}

export function useMcpPolicy(orgSlug: string, opts?: { enabled?: boolean }) {
  return useQuery<McpPolicy | null>({
    queryKey: connectKeys.policy(orgSlug),
    queryFn: () => connect.getMcpPolicy(orgSlug),
    enabled: (opts?.enabled ?? true) && !!orgSlug,
  });
}

export function useSetMcpPolicy(orgSlug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (enabled: boolean) => {
      const policy = await connect.setMcpPolicy(orgSlug, enabled);
      if (!policy) throw new Error("mcp policy response did not parse");
      return policy;
    },
    onSuccess: (policy) => qc.setQueryData(connectKeys.policy(orgSlug), policy),
  });
}

export function useSetMcpWritePolicy(orgSlug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (enabled: boolean) => {
      const policy = await connect.setMcpWritePolicy(orgSlug, enabled);
      if (!policy) throw new Error("mcp write policy response did not parse");
      return policy;
    },
    onSuccess: (policy) => qc.setQueryData(connectKeys.policy(orgSlug), policy),
  });
}

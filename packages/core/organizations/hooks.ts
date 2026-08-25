"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as organizations from "../api/endpoints/organizations";
import type { Workspace } from "../types/workspace";
import { workspaceKeys } from "../workspaces/hooks";

export const organizationKeys = {
  list: () => ["organizations"] as const,
  workspaces: (orgId: string) => ["org-workspaces", orgId] as const,
};

export function useOrganizations() {
  return useQuery({
    queryKey: organizationKeys.list(),
    queryFn: () => organizations.list(),
  });
}

export function useCreateOrganization() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; slug: string }) => organizations.create(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: organizationKeys.list() }),
  });
}

export function useOrgWorkspaces(orgId: string) {
  return useQuery({
    queryKey: organizationKeys.workspaces(orgId),
    queryFn: () => organizations.listWorkspaces(orgId),
    enabled: !!orgId,
  });
}

export function useCreateWorkspaceInOrg() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ orgId, name, slug }: { orgId: string; name: string; slug: string }) =>
      organizations.createWorkspace(orgId, { name, slug }),
    // Seed the caches BEFORE the caller navigates so the [orgSlug]/[workspaceSlug]
    // layout resolves immediately instead of flashing a loader.
    onSuccess: (workspace) => {
      if (!workspace) {
        void qc.invalidateQueries({ queryKey: workspaceKeys.list() });
        return;
      }
      qc.setQueryData<Workspace[]>(workspaceKeys.list(), (old) => [...(old ?? []), workspace]);
      qc.setQueryData(workspaceKeys.bySlugs(workspace.organization_slug, workspace.slug), workspace);
      void qc.invalidateQueries({ queryKey: organizationKeys.workspaces(workspace.organization_id) });
    },
    onError: () => qc.invalidateQueries({ queryKey: workspaceKeys.list() }),
  });
}

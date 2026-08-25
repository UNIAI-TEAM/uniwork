"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import * as api from "../api/client";
import { OrganizationSchema, WorkspaceSchema, type Workspace } from "../types";

const OrgsResponse = z.object({ organizations: z.array(OrganizationSchema) });
const OrgResponse = z.object({ organization: OrganizationSchema });
const WorkspacesResponse = z.object({ workspaces: z.array(WorkspaceSchema) });
const WorkspaceResponse = z.object({ workspace: WorkspaceSchema });

export function useOrganizations() {
  return useQuery({
    queryKey: ["organizations"],
    queryFn: () => api.request("/api/v1/orgs", { schema: OrgsResponse }),
    select: (d) => d.organizations,
  });
}

export function useCreateOrganization() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; slug: string }) =>
      api.request("/api/v1/orgs", { method: "POST", body, schema: OrgResponse }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["organizations"] }),
  });
}

export function useOrgWorkspaces(orgId: string) {
  return useQuery({
    queryKey: ["org-workspaces", orgId],
    queryFn: () => api.request(`/api/v1/orgs/${orgId}/workspaces`, { schema: WorkspacesResponse }),
    select: (d) => d.workspaces,
    enabled: !!orgId,
  });
}

export function useCreateWorkspaceInOrg() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ orgId, name, slug }: { orgId: string; name: string; slug: string }) =>
      api.request(`/api/v1/orgs/${orgId}/workspaces`, {
        method: "POST",
        body: { name, slug },
        schema: WorkspaceResponse,
      }),
    // Seed cache TRƯỚC khi caller navigate để layout [orgSlug]/[workspaceSlug]
    // resolve ngay, không nháy.
    onSuccess: (d) => {
      qc.setQueryData<{ workspaces: Workspace[] }>(["workspaces"], (old) => ({
        workspaces: [...(old?.workspaces ?? []), d.workspace],
      }));
      qc.setQueryData(["workspace", d.workspace.organization_slug, d.workspace.slug], d);
      void qc.invalidateQueries({ queryKey: ["org-workspaces", d.workspace.organization_id] });
    },
    onError: () => qc.invalidateQueries({ queryKey: ["workspaces"] }),
  });
}

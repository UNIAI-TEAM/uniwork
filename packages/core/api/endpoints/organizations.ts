import { z } from "zod";
import { OrganizationSchema, type Organization } from "../../types/organization";
import { WorkspaceSchema, type Workspace } from "../../types/workspace";
import { request } from "../http";
import { parseWithFallback } from "../schema";

const OrgsResponse = z.object({ organizations: z.array(OrganizationSchema) });
const OrgResponse = z.object({ organization: OrganizationSchema });
const WorkspacesResponse = z.object({ workspaces: z.array(WorkspaceSchema) });
const WorkspaceResponse = z.object({ workspace: WorkspaceSchema });

export async function list(): Promise<Organization[]> {
  const raw = await request("/api/v1/orgs");
  return parseWithFallback<{ organizations: Organization[] }>(raw, OrgsResponse, { organizations: [] }, {
    endpoint: "GET /api/v1/orgs",
  }).organizations;
}

export async function create(body: { name: string; slug: string }): Promise<Organization | null> {
  const raw = await request("/api/v1/orgs", { method: "POST", body });
  return parseWithFallback<{ organization: Organization } | null>(raw, OrgResponse, null, {
    endpoint: "POST /api/v1/orgs",
  })?.organization ?? null;
}

export async function listWorkspaces(orgId: string): Promise<Workspace[]> {
  const raw = await request(`/api/v1/orgs/${encodeURIComponent(orgId)}/workspaces`);
  return parseWithFallback<{ workspaces: Workspace[] }>(raw, WorkspacesResponse, { workspaces: [] }, {
    endpoint: "GET /api/v1/orgs/{org}/workspaces",
  }).workspaces;
}

export async function createWorkspace(
  orgId: string,
  body: { name: string; slug: string },
): Promise<Workspace | null> {
  const raw = await request(`/api/v1/orgs/${encodeURIComponent(orgId)}/workspaces`, {
    method: "POST",
    body,
  });
  return parseWithFallback<{ workspace: Workspace } | null>(raw, WorkspaceResponse, null, {
    endpoint: "POST /api/v1/orgs/{org}/workspaces",
  })?.workspace ?? null;
}

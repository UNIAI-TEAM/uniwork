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

/**
 * Whether every chat push of the organization hides the message's words (GET/PUT
 * /api/v1/orgs/{org}/push-preview-policy). A drifted answer reads as the server's
 * default: shown, and not the caller's to change.
 */
const PushPreviewPolicySchema = z.object({
  hidden: z.boolean().catch(false),
  hidden_at: z.string().nullable().default(null).catch(null),
  can_manage: z.boolean().catch(false),
});
export type PushPreviewPolicy = z.infer<typeof PushPreviewPolicySchema>;
const NO_PUSH_PREVIEW_POLICY: PushPreviewPolicy = { hidden: false, hidden_at: null, can_manage: false };

export async function getPushPreviewPolicy(orgSlug: string): Promise<PushPreviewPolicy> {
  const raw = await request(`/api/v1/orgs/${encodeURIComponent(orgSlug)}/push-preview-policy`);
  return parseWithFallback<PushPreviewPolicy>(raw, PushPreviewPolicySchema, NO_PUSH_PREVIEW_POLICY, {
    endpoint: "GET /api/v1/orgs/{org}/push-preview-policy",
  });
}

export async function setPushPreviewPolicy(orgSlug: string, hidden: boolean): Promise<PushPreviewPolicy> {
  const raw = await request(`/api/v1/orgs/${encodeURIComponent(orgSlug)}/push-preview-policy`, { method: "PUT", body: { hidden } });
  return parseWithFallback<PushPreviewPolicy>(raw, PushPreviewPolicySchema, { ...NO_PUSH_PREVIEW_POLICY, hidden, can_manage: true }, {
    endpoint: "PUT /api/v1/orgs/{org}/push-preview-policy",
  });
}

import { z } from "zod";
import {
  MemberSchema,
  PendingInvitationSchema,
  WorkspaceSchema,
  type Member,
  type PendingInvitation,
  type Workspace,
} from "../../types/workspace";
import { request } from "../http";
import { parseWithFallback } from "../schema";

const WorkspacesResponse = z.object({ workspaces: z.array(WorkspaceSchema) });
const WorkspaceResponse = z.object({ workspace: WorkspaceSchema });
const MembersResponse = z.object({ members: z.array(MemberSchema) });
const MyInvitationsResponse = z.object({ invitations: z.array(PendingInvitationSchema) });
const InviteResponse = z.object({
  invitations: z.array(
    z.object({ id: z.string(), email: z.string(), role: z.string(), token: z.string() }),
  ),
  skipped: z.array(z.string()),
});
export type InviteResult = z.infer<typeof InviteResponse>;

const enc = encodeURIComponent;

export async function list(): Promise<Workspace[]> {
  const raw = await request("/api/v1/workspaces");
  return parseWithFallback<{ workspaces: Workspace[] }>(raw, WorkspacesResponse, { workspaces: [] }, {
    endpoint: "GET /api/v1/workspaces",
  }).workspaces;
}

/**
 * Resolves a workspace from the URL pair. A drifted response returns null,
 * which the workspace guard treats the same as not found — the safe direction
 * for a gate.
 */
export async function getBySlugs(orgSlug: string, wsSlug: string): Promise<Workspace | null> {
  const raw = await request(`/api/v1/orgs/${enc(orgSlug)}/workspaces/${enc(wsSlug)}`);
  return parseWithFallback<{ workspace: Workspace } | null>(raw, WorkspaceResponse, null, {
    endpoint: "GET /api/v1/orgs/{org}/workspaces/{ws}",
  })?.workspace ?? null;
}

export async function listMembers(workspaceId: string): Promise<Member[]> {
  const raw = await request(`/api/v1/workspaces/${enc(workspaceId)}/members`);
  // MemberSchema keeps role as a string on the wire; Member narrows it to the
  // known union for callers, and permissions treat anything else as "member".
  return parseWithFallback<{ members: Member[] }>(raw, MembersResponse, { members: [] }, {
    endpoint: "GET /api/v1/workspaces/{ws}/members",
  }).members;
}

export async function invite(
  workspaceId: string,
  body: { emails: string[]; role: "admin" | "member" },
): Promise<InviteResult> {
  const raw = await request(`/api/v1/workspaces/${enc(workspaceId)}/invitations`, {
    method: "POST",
    body,
  });
  return parseWithFallback<InviteResult>(raw, InviteResponse, { invitations: [], skipped: [] }, {
    endpoint: "POST /api/v1/workspaces/{ws}/invitations",
  });
}

export async function myInvitations(): Promise<PendingInvitation[]> {
  const raw = await request("/api/v1/me/invitations");
  return parseWithFallback<{ invitations: PendingInvitation[] }>(
    raw,
    MyInvitationsResponse,
    { invitations: [] },
    { endpoint: "GET /api/v1/me/invitations" },
  ).invitations;
}

export async function acceptInvite(token: string): Promise<Workspace | null> {
  const raw = await request(`/api/v1/invitations/${enc(token)}/accept`, { method: "POST" });
  return parseWithFallback<{ workspace: Workspace } | null>(raw, WorkspaceResponse, null, {
    endpoint: "POST /api/v1/invitations/{token}/accept",
  })?.workspace ?? null;
}

export async function patchWorkspace(workspaceId: string, body: { name: string }): Promise<Workspace | null> {
  const raw = await request(`/api/v1/workspaces/${enc(workspaceId)}`, { method: "PATCH", body });
  return parseWithFallback<{ workspace: Workspace } | null>(raw, WorkspaceResponse, null, {
    endpoint: "PATCH /api/v1/workspaces/{ws}",
  })?.workspace ?? null;
}

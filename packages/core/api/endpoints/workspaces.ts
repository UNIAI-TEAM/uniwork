import { z } from "zod";
import {
  MemberSchema,
  PendingInvitationSchema,
  WorkspaceMembershipSchema,
  WorkspaceSchema,
  type Member,
  type PendingInvitation,
  type Workspace,
  type WorkspaceMembership,
} from "../../types/workspace";
import { request } from "../http";
import { parseWithFallback } from "../schema";

const WorkspacesResponse = z.object({ workspaces: z.array(WorkspaceSchema) });
const WorkspaceResponse = z.object({ workspace: WorkspaceSchema });
const MembersResponse = z.object({ members: z.array(MemberSchema) });
const MembershipResponse = z.object({ membership: WorkspaceMembershipSchema });
const MyInvitationsResponse = z.object({ invitations: z.array(PendingInvitationSchema) });
const InviteResponse = z.object({
  invitations: z.array(z.object({ id: z.string(), email: z.string(), role: z.string() })),
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

export async function getMyMembership(workspaceId: string): Promise<WorkspaceMembership | null> {
  const raw = await request(`/api/v1/workspaces/${enc(workspaceId)}/me`);
  return (
    parseWithFallback<{ membership: WorkspaceMembership } | null>(raw, MembershipResponse, null, {
      endpoint: "GET /api/v1/workspaces/{ws}/me",
    })?.membership ?? null
  );
}

export async function updateMemberRole(
  workspaceId: string,
  userId: string,
  body: { role: "admin" | "member" },
): Promise<unknown> {
  return request(`/api/v1/workspaces/${enc(workspaceId)}/members/${enc(userId)}`, {
    method: "PATCH",
    body,
  });
}

export async function removeMember(workspaceId: string, userId: string): Promise<void> {
  await request(`/api/v1/workspaces/${enc(workspaceId)}/members/${enc(userId)}`, {
    method: "DELETE",
  });
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

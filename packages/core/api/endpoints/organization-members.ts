import { z } from "zod";
import {
  OrgInvitationSchema,
  OrgMemberSchema,
  OrgMembershipSchema,
  type OrgInvitation,
  type OrgMember,
  type OrgMembership,
} from "../../types/people";
import { request } from "../http";
import { parseWithFallback } from "../schema";

const MemberListResponse = z.object({
  members: z.array(OrgMemberSchema),
  next_cursor: z.string().optional(),
});
const MemberResponse = z.object({ member: OrgMemberSchema });
const StatusResponse = z.object({ status: z.string() });

export interface OrgMemberPage {
  members: OrgMember[];
  next_cursor?: string;
}

const EMPTY_PAGE: OrgMemberPage = { members: [] };

export async function listOrgMembers(
  orgSlug: string,
  status?: string,
  cursor?: string,
): Promise<OrgMemberPage> {
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  if (cursor) params.set("cursor", cursor);
  const qs = params.toString();
  const raw = await request(`/api/v1/orgs/${encodeURIComponent(orgSlug)}/members${qs ? `?${qs}` : ""}`);
  return parseWithFallback<OrgMemberPage>(raw, MemberListResponse, EMPTY_PAGE, {
    endpoint: "GET /api/v1/orgs/{org}/members",
  });
}

/**
 * The caller's own membership. It answers even when the membership is
 * deactivated — that is exactly the state the blocked screen is drawn from.
 */
export async function getOrgMembership(orgSlug: string): Promise<OrgMembership | null> {
  const raw = await request(`/api/v1/orgs/${encodeURIComponent(orgSlug)}/members/me`);
  return parseWithFallback<OrgMembership | null>(raw, OrgMembershipSchema, null, {
    endpoint: "GET /api/v1/orgs/{org}/members/me",
  });
}

export async function updateOrgMemberRole(
  orgSlug: string,
  userId: string,
  role: string,
): Promise<OrgMember | null> {
  const raw = await request(
    `/api/v1/orgs/${encodeURIComponent(orgSlug)}/members/${encodeURIComponent(userId)}`,
    { method: "PATCH", body: { role } },
  );
  return parseWithFallback<{ member: OrgMember } | null>(raw, MemberResponse, null, {
    endpoint: "PATCH /api/v1/orgs/{org}/members/{userID}",
  })?.member ?? null;
}

export async function deactivateOrgMember(orgSlug: string, userId: string): Promise<OrgMember | null> {
  const raw = await request(
    `/api/v1/orgs/${encodeURIComponent(orgSlug)}/members/${encodeURIComponent(userId)}/deactivate`,
    { method: "POST" },
  );
  return parseWithFallback<{ member: OrgMember } | null>(raw, MemberResponse, null, {
    endpoint: "POST /api/v1/orgs/{org}/members/{userID}/deactivate",
  })?.member ?? null;
}

export async function reactivateOrgMember(orgSlug: string, userId: string): Promise<OrgMember | null> {
  const raw = await request(
    `/api/v1/orgs/${encodeURIComponent(orgSlug)}/members/${encodeURIComponent(userId)}/reactivate`,
    { method: "POST" },
  );
  return parseWithFallback<{ member: OrgMember } | null>(raw, MemberResponse, null, {
    endpoint: "POST /api/v1/orgs/{org}/members/{userID}/reactivate",
  })?.member ?? null;
}

export async function leaveOrganization(orgSlug: string): Promise<boolean> {
  const raw = await request(`/api/v1/orgs/${encodeURIComponent(orgSlug)}/leave`, { method: "POST" });
  return parseWithFallback<{ status: string }>(raw, StatusResponse, { status: "" }, {
    endpoint: "POST /api/v1/orgs/{org}/leave",
  }).status === "ok";
}

const InvitationListResponse = z.object({
  invitations: z.array(OrgInvitationSchema),
  skipped: z.array(z.string()).default([]),
});

export interface OrgInvitationResult {
  invitations: OrgInvitation[];
  skipped: string[];
}

const EMPTY_INVITATIONS: OrgInvitationResult = { invitations: [], skipped: [] };

export async function listOrgInvitations(orgSlug: string): Promise<OrgInvitationResult> {
  const raw = await request(`/api/v1/orgs/${encodeURIComponent(orgSlug)}/invitations`);
  return parseWithFallback<OrgInvitationResult>(raw, InvitationListResponse, EMPTY_INVITATIONS, {
    endpoint: "GET /api/v1/orgs/{org}/invitations",
  });
}

export async function inviteToOrganization(
  orgSlug: string,
  emails: string[],
  orgRole: string,
): Promise<OrgInvitationResult> {
  const raw = await request(`/api/v1/orgs/${encodeURIComponent(orgSlug)}/invitations`, {
    method: "POST",
    body: { emails, org_role: orgRole },
  });
  return parseWithFallback<OrgInvitationResult>(raw, InvitationListResponse, EMPTY_INVITATIONS, {
    endpoint: "POST /api/v1/orgs/{org}/invitations",
  });
}

export async function revokeOrgInvitation(orgSlug: string, invitationId: string): Promise<boolean> {
  const raw = await request(
    `/api/v1/orgs/${encodeURIComponent(orgSlug)}/invitations/${encodeURIComponent(invitationId)}`,
    { method: "DELETE" },
  );
  return parseWithFallback<{ status: string }>(raw, StatusResponse, { status: "" }, {
    endpoint: "DELETE /api/v1/orgs/{org}/invitations/{invitationId}",
  }).status === "ok";
}

/**
 * Handing the organization to somebody else. The current owner re-enters their
 * password, because this is the one change they cannot undo alone afterwards.
 */
export async function transferOwnership(
  orgSlug: string,
  toUserId: string,
  password: string,
): Promise<OrgMember | null> {
  const raw = await request(`/api/v1/orgs/${encodeURIComponent(orgSlug)}/transfer-ownership`, {
    method: "POST",
    body: { to_user_id: toUserId, password },
  });
  return parseWithFallback<{ member: OrgMember } | null>(raw, MemberResponse, null, {
    endpoint: "POST /api/v1/orgs/{org}/transfer-ownership",
  })?.member ?? null;
}

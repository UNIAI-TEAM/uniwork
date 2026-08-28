"use client";

import { useSession } from "../auth/hooks";
import { MEMBER_ROLES, type Member, type MemberRole } from "../types/workspace";
import { ORG_ROLES, type OrgRole } from "../types/organization";
import { useMembers, useMyMembership } from "../workspaces/hooks";
import { useOrganizations } from "../organizations/hooks";

function asMemberRole(role: string | undefined): MemberRole | null {
  return (MEMBER_ROLES as readonly string[]).includes(role ?? "") ? (role as MemberRole) : null;
}

function asOrgRole(role: string | undefined): OrgRole | null {
  return (ORG_ROLES as readonly string[]).includes(role ?? "") ? (role as OrgRole) : null;
}

/**
 * The current user's membership in a workspace — the single source of truth
 * for "what role am I", replacing ad-hoc `members.find(...)` in views.
 *
 * Role comes from GET /workspaces/{id}/me (effective role, including implicit
 * org admin). The members list is only used for the explicit Member row when
 * present.
 */
export function useCurrentMember(wsId: string): {
  userId: string | null;
  role: MemberRole | null;
  member: Member | null;
  source: "membership" | "org_admin" | null;
  isLoading: boolean;
} {
  const { user, status } = useSession();
  const userId = user?.id ?? null;
  const { data: membership, isLoading: meLoading } = useMyMembership(wsId);
  const { data: members } = useMembers(wsId);
  const member = members?.find((m) => m.user_id === userId) ?? null;
  const source =
    membership?.source === "org_admin" || membership?.source === "membership"
      ? membership.source
      : null;
  return {
    userId,
    role: asMemberRole(membership?.role),
    member,
    source,
    isLoading: status === "loading" || meLoading,
  };
}

/** The current user's role in an organization, from the organizations list. */
export function useOrgMembership(orgId: string): { role: OrgRole | null; isLoading: boolean } {
  const { data: orgs, isLoading } = useOrganizations();
  const org = orgs?.find((o) => o.id === orgId);
  return { role: asOrgRole(org?.role), isLoading };
}

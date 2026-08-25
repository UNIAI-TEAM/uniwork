"use client";

import { useSession } from "../auth/hooks";
import { useOrganizations } from "../organizations/hooks";
import { MEMBER_ROLES, type Member, type MemberRole } from "../types/workspace";
import { ORG_ROLES, type OrgRole } from "../types/organization";
import { useMembers } from "../workspaces/hooks";

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
 * `wsId` is explicit so the hook stays usable in components that render
 * before workspace context is wired. A role the client does not recognise
 * resolves to null (least privilege), never to a guess.
 */
export function useCurrentMember(wsId: string): {
  userId: string | null;
  role: MemberRole | null;
  member: Member | null;
  isLoading: boolean;
} {
  const { user, status } = useSession();
  const userId = user?.id ?? null;
  const { data: members, isLoading } = useMembers(wsId);
  const member = members?.find((m) => m.user_id === userId) ?? null;
  return {
    userId,
    role: asMemberRole(member?.role),
    member,
    isLoading: status === "loading" || isLoading,
  };
}

/** The current user's role in an organization, from the organizations list. */
export function useOrgMembership(orgId: string): { role: OrgRole | null; isLoading: boolean } {
  const { data: orgs, isLoading } = useOrganizations();
  const org = orgs?.find((o) => o.id === orgId);
  return { role: asOrgRole(org?.role), isLoading };
}

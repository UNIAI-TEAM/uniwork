"use client";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as organizations from "../api/endpoints/organizations";
import * as orgMembers from "../api/endpoints/organization-members";
import { peopleKeys } from "../people/hooks";
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

// --- Organization membership (F-03) ---------------------------------------
//
// These are keyed by organization slug because that is what the routes carry;
// the workspace-level member hooks in ../workspaces stay separate, since the
// two tiers grant different things.

/** Prefix shared by every organization-membership query; see peopleRootKey. */
export const orgMemberRootKey = ["org-members"] as const;

export const orgMemberKeys = {
  all: (orgSlug: string) => ["org-members", orgSlug] as const,
  list: (orgSlug: string, status: string) => ["org-members", orgSlug, status] as const,
  me: (orgSlug: string) => ["org-members", orgSlug, "me"] as const,
};

export function useOrgMembers(orgSlug: string, status = "active") {
  return useInfiniteQuery({
    queryKey: orgMemberKeys.list(orgSlug, status),
    queryFn: ({ pageParam }) => orgMembers.listOrgMembers(orgSlug, status, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor || undefined,
    enabled: !!orgSlug,
  });
}

/**
 * The caller's own standing. Kept separate from useOrganizations() because it
 * answers while the membership is deactivated, which is what the blocked
 * screen needs and what the organization list cannot express.
 */
export function useOrgMembership(orgSlug: string) {
  return useQuery({
    queryKey: orgMemberKeys.me(orgSlug),
    queryFn: () => orgMembers.getOrgMembership(orgSlug),
    enabled: !!orgSlug,
  });
}

function useOrgMemberMutation<TVars>(orgSlug: string, fn: (vars: TVars) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: orgMemberKeys.all(orgSlug) });
      void qc.invalidateQueries({ queryKey: peopleKeys.all(orgSlug) });
    },
  });
}

export function useUpdateOrgMemberRole(orgSlug: string) {
  return useOrgMemberMutation(orgSlug, ({ userId, role }: { userId: string; role: string }) =>
    orgMembers.updateOrgMemberRole(orgSlug, userId, role),
  );
}

export function useDeactivateOrgMember(orgSlug: string) {
  return useOrgMemberMutation(orgSlug, (userId: string) => orgMembers.deactivateOrgMember(orgSlug, userId));
}

export function useReactivateOrgMember(orgSlug: string) {
  return useOrgMemberMutation(orgSlug, (userId: string) => orgMembers.reactivateOrgMember(orgSlug, userId));
}

/**
 * Leaving removes the caller from the organization and every workspace in it,
 * so the whole cache is dropped rather than selectively invalidated: what the
 * client holds is no longer theirs to read.
 */
export function useLeaveOrganization(orgSlug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => orgMembers.leaveOrganization(orgSlug),
    onSuccess: () => qc.clear(),
  });
}

export function useOrgInvitations(orgSlug: string, enabled = true) {
  return useQuery({
    queryKey: [...orgMemberKeys.all(orgSlug), "invitations"] as const,
    queryFn: () => orgMembers.listOrgInvitations(orgSlug),
    enabled: enabled && !!orgSlug,
  });
}

export function useInviteToOrganization(orgSlug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ emails, orgRole }: { emails: string[]; orgRole: string }) =>
      orgMembers.inviteToOrganization(orgSlug, emails, orgRole),
    onSuccess: () => qc.invalidateQueries({ queryKey: orgMemberKeys.all(orgSlug) }),
  });
}

export function useRevokeOrgInvitation(orgSlug: string) {
  return useOrgMemberMutation(orgSlug, (invitationId: string) =>
    orgMembers.revokeOrgInvitation(orgSlug, invitationId),
  );
}

/**
 * Handing the organization over changes what the caller may do everywhere, so
 * the whole cache is refreshed rather than the membership list alone.
 */
export function useTransferOwnership(orgSlug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ toUserId, password }: { toUserId: string; password: string }) =>
      orgMembers.transferOwnership(orgSlug, toUserId, password),
    onSuccess: () => qc.invalidateQueries(),
  });
}

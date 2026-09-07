"use client";

import type { Task } from "../types/task";
import type { Member } from "../types/workspace";
import {
  canChangeMemberRole,
  canChangeOrgRole,
  canCreateWorkspaceInOrg,
  canDeactivateMember,
  canEditEmploymentFields,
  canEditProfile,
  canExportPeople,
  canLeaveOrg,
  canManageDepartments,
  canManageOrgMembers,
  canTransferOwnership,
  canManageAuditSettings,
  canManageBilling,
  canReadAuditLog,
  canViewBilling,
  canDeleteMeeting,
  canDeleteTask,
  canEditTask,
  canInviteMembers,
  canManageMembers,
  canRemoveMember,
  canUpdateWorkspaceSettings,
} from "./rules";
import { deny, type Decision, type PermissionContext } from "./types";
import { useSession } from "../auth/hooks";
import { useCurrentMember, useOrgMembership } from "./use-current-member";
import { useOrgMembership as useOrgMembershipRow } from "../organizations/hooks";
import { ORG_ROLES, type OrgRole } from "../types/organization";

/** Every Decision collapses to this while memberships are still loading, so callers stay branch-free. */
const PENDING: Decision = deny("unknown", "");

/**
 * Per-surface hooks. Each calls useCurrentMember once and threads the context
 * into the pure rules. `wsId` is explicit rather than read from a provider, so
 * the hooks work outside a workspace layout too.
 */
/**
 * The audit screen's two gates. Both read the organization role, not the
 * workspace one: the log spans every workspace in the organization, so a
 * workspace admin is not automatically allowed to read other teams' activity.
 */
export function useAuditPermissions(orgId: string): {
  canRead: Decision;
  canManage: Decision;
  isLoading: boolean;
} {
  const { user, status } = useSession();
  const { role, isLoading } = useOrgMembership(orgId);
  const loading = isLoading || status === "loading";
  if (loading) return { canRead: PENDING, canManage: PENDING, isLoading: loading };
  const ctx: PermissionContext = { userId: user?.id ?? null, orgRole: role, wsRole: null };
  return { canRead: canReadAuditLog(ctx), canManage: canManageAuditSettings(ctx), isLoading: loading };
}

export function useWorkspacePermissions(wsId: string): {
  canInvite: Decision;
  canManageMembers: Decision;
  canDeleteMeeting: Decision;
  canUpdateSettings: Decision;
  decideRemove: (target: Member) => Decision;
  decideChangeRole: (target: Member) => Decision;
  isLoading: boolean;
} {
  const { userId, role, isLoading } = useCurrentMember(wsId);
  const ctx: PermissionContext = { userId, orgRole: null, wsRole: role };
  if (isLoading) {
    return {
      canInvite: PENDING,
      canManageMembers: PENDING,
      canDeleteMeeting: PENDING,
      canUpdateSettings: PENDING,
      decideRemove: () => PENDING,
      decideChangeRole: () => PENDING,
      isLoading,
    };
  }
  return {
    canInvite: canInviteMembers(ctx),
    canManageMembers: canManageMembers(ctx),
    canDeleteMeeting: canDeleteMeeting(null, ctx),
    canUpdateSettings: canUpdateWorkspaceSettings(ctx),
    decideRemove: (target: Member) => canRemoveMember(target, ctx),
    decideChangeRole: (target: Member) => canChangeMemberRole(target, ctx),
    isLoading,
  };
}

export function useTaskPermissions(
  task: Task | null,
  wsId: string,
): { canEdit: Decision; canDelete: Decision; isLoading: boolean } {
  const { userId, role, isLoading } = useCurrentMember(wsId);
  const ctx: PermissionContext = { userId, orgRole: null, wsRole: role };
  if (isLoading || task === null) return { canEdit: PENDING, canDelete: PENDING, isLoading };
  return { canEdit: canEditTask(task, ctx), canDelete: canDeleteTask(task, ctx), isLoading };
}

export function useBillingPermissions(orgId: string): {
  canView: Decision;
  canManage: Decision;
  isLoading: boolean;
} {
  const { user, status } = useSession();
  const { role, isLoading } = useOrgMembership(orgId);
  const loading = isLoading || status === "loading";
  if (loading) return { canView: PENDING, canManage: PENDING, isLoading: loading };
  const ctx: PermissionContext = { userId: user?.id ?? null, orgRole: role, wsRole: null };
  return { canView: canViewBilling(ctx), canManage: canManageBilling(ctx), isLoading: loading };
}

export function useOrgPermissions(orgId: string): { canCreateWorkspace: Decision; isLoading: boolean } {
  const { role, isLoading } = useOrgMembership(orgId);
  // Org rules do not need a user id beyond "is there a session": membership
  // implies one, and a null role already denies.
  const ctx: PermissionContext = { userId: role === null ? null : "member", orgRole: role, wsRole: null };
  if (isLoading) return { canCreateWorkspace: PENDING, isLoading };
  return { canCreateWorkspace: canCreateWorkspaceInOrg(ctx), isLoading };
}

export function useMeetingPermissions(
  meeting: { host_user_id?: string } | null,
  wsId: string,
): { canHost: Decision; canCancel: Decision; isLoading: boolean } {
  const { userId, role, isLoading } = useCurrentMember(wsId);
  const ctx: PermissionContext = { userId, orgRole: null, wsRole: role };
  if (isLoading) return { canHost: PENDING, canCancel: PENDING, isLoading };
  const d = canDeleteMeeting(meeting, ctx);
  return { canHost: d, canCancel: d, isLoading };
}

/**
 * The directory's gates (F-03). Everything here reads the organization tier,
 * and by slug rather than id, because that is what the people routes carry —
 * and because GET /orgs/{org}/members/me answers even while the membership is
 * deactivated, which the organizations list cannot express.
 */
export function usePeoplePermissions(orgSlug: string): {
  canManageMembers: Decision;
  canManageDepartments: Decision;
  canExport: Decision;
  canEditEmployment: Decision;
  canTransferOwnership: Decision;
  canLeave: Decision;
  decideEditProfile: (target: { user_id: string } | null) => Decision;
  decideChangeRole: (target: { user_id: string; role: string } | null) => Decision;
  decideDeactivate: (target: { user_id: string; role: string } | null) => Decision;
  isLoading: boolean;
} {
  const { user, status } = useSession();
  const { data: membership, isLoading } = useOrgMembershipRow(orgSlug);
  const loading = isLoading || status === "loading";
  const ctx: PermissionContext = {
    userId: user?.id ?? null,
    orgRole: (ORG_ROLES as readonly string[]).includes(membership?.role ?? "")
      ? (membership?.role as OrgRole)
      : null,
    wsRole: null,
    orgMemberStatus: membership ? (membership.deactivated_at ? "deactivated" : "active") : null,
  };
  const pending = <T,>(_target: T): Decision => PENDING;
  if (loading) {
    return {
      canManageMembers: PENDING,
      canManageDepartments: PENDING,
      canExport: PENDING,
      canEditEmployment: PENDING,
      canTransferOwnership: PENDING,
      canLeave: PENDING,
      decideEditProfile: pending,
      decideChangeRole: pending,
      decideDeactivate: pending,
      isLoading: loading,
    };
  }
  return {
    canManageMembers: canManageOrgMembers(ctx),
    canManageDepartments: canManageDepartments(ctx),
    canExport: canExportPeople(ctx),
    canEditEmployment: canEditEmploymentFields(ctx),
    canTransferOwnership: canTransferOwnership(ctx),
    canLeave: canLeaveOrg(ctx),
    decideEditProfile: (target) => canEditProfile(target, ctx),
    decideChangeRole: (target) => canChangeOrgRole(target, ctx),
    decideDeactivate: (target) => canDeactivateMember(target, ctx),
    isLoading: loading,
  };
}

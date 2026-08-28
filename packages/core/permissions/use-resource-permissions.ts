"use client";

import type { Task } from "../types/task";
import {
  canCreateWorkspaceInOrg,
  canDeleteMeeting,
  canDeleteTask,
  canEditTask,
  canInviteMembers,
  canManageMembers,
  canUpdateWorkspaceSettings,
} from "./rules";
import { deny, type Decision, type PermissionContext } from "./types";
import { useCurrentMember, useOrgMembership } from "./use-current-member";

/** Every Decision collapses to this while memberships are still loading, so callers stay branch-free. */
const PENDING: Decision = deny("unknown", "");

/**
 * Per-surface hooks. Each calls useCurrentMember once and threads the context
 * into the pure rules. `wsId` is explicit rather than read from a provider, so
 * the hooks work outside a workspace layout too.
 */
export function useWorkspacePermissions(wsId: string): {
  canInvite: Decision;
  canManageMembers: Decision;
  canDeleteMeeting: Decision;
  canUpdateSettings: Decision;
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
      isLoading,
    };
  }
  return {
    canInvite: canInviteMembers(ctx),
    canManageMembers: canManageMembers(ctx),
    canDeleteMeeting: canDeleteMeeting(null, ctx),
    canUpdateSettings: canUpdateWorkspaceSettings(ctx),
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

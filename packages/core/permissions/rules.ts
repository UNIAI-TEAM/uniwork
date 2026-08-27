import type { Task } from "../types/task";
import { ALLOW, deny, isAdminLike, type Decision, type PermissionContext } from "./types";

/**
 * Pure permission rules — single source of truth that MIRRORS the Go gates in
 * server/internal/service. Hooks in use-resource-permissions.ts are thin
 * wrappers that build a PermissionContext from the session and member queries
 * and forward here.
 *
 * Mirror means mirror: where the backend is permissive, so is the rule, with
 * the gate cited. Tightening a rule here without the backend would only hide
 * a button; loosening it would show one that 403s.
 */

function requireWorkspaceMember(ctx: PermissionContext): Decision | null {
  if (ctx.userId === null) return deny("not_authenticated", "Sign in to continue.");
  if (ctx.wsRole === null) return deny("not_member", "You are not a member of this workspace.");
  return null;
}

// ---- Workspace membership ------------------------------------------------

/**
 * Invite people to the workspace.
 * Backend: WorkspaceService.InviteMany — `m.Role != "owner" && m.Role != "admin"` → 403
 * (server/internal/service/workspace.go:136).
 */
export function canInviteMembers(ctx: PermissionContext): Decision {
  const gate = requireWorkspaceMember(ctx);
  if (gate) return gate;
  if (isAdminLike(ctx.wsRole)) return ALLOW;
  return deny("not_admin_role", "Only workspace owners and admins can invite members.");
}

/** Same gate as inviting today; kept separate so the two can diverge without a rename. */
export function canManageMembers(ctx: PermissionContext): Decision {
  return canInviteMembers(ctx);
}

/**
 * Remove a workspace member (or leave yourself).
 * Backend: WorkspaceService.RemoveMember — admin-like for others; any member may
 * leave; explicit owner protected (server/internal/service/workspace.go).
 */
export function canRemoveMember(
  target: { user_id: string; role: string } | null,
  ctx: PermissionContext,
): Decision {
  const gate = requireWorkspaceMember(ctx);
  if (gate) return gate;
  if (!target) return deny("unknown", "Member not found.");
  if (target.role === "owner") {
    return deny("not_owner_role", "Workspace owners cannot be removed this way.");
  }
  if (ctx.userId === target.user_id) return ALLOW;
  if (isAdminLike(ctx.wsRole)) return ALLOW;
  return deny("not_admin_role", "Only workspace owners and admins can remove members.");
}

/**
 * Change a non-owner member's role between admin and member.
 * Backend: WorkspaceService.UpdateMemberRole (server/internal/service/workspace.go).
 */
export function canChangeMemberRole(
  target: { user_id: string; role: string } | null,
  ctx: PermissionContext,
): Decision {
  const gate = requireWorkspaceMember(ctx);
  if (gate) return gate;
  if (!isAdminLike(ctx.wsRole)) {
    return deny("not_admin_role", "Only workspace owners and admins can change roles.");
  }
  if (!target) return deny("unknown", "Member not found.");
  if (target.role === "owner") {
    return deny("not_owner_role", "Workspace owner role cannot be changed this way.");
  }
  return ALLOW;
}

/** Mirror workspace.go InviteMany admin gate. */
export function canUpdateWorkspaceSettings(ctx: PermissionContext): Decision {
  const gate = requireWorkspaceMember(ctx);
  if (gate) return gate;
  if (isAdminLike(ctx.wsRole)) return ALLOW;
  return deny("not_admin_role", "Only workspace owners and admins can update workspace settings.");
}

// ---- Organization ---------------------------------------------------------

/**
 * Create a workspace inside an organization.
 * Backend: WorkspaceService.CreateInOrg only requires organization membership
 * (server/internal/service/workspace.go:44, via OrganizationService.RequireMember).
 */
export function canCreateWorkspaceInOrg(ctx: PermissionContext): Decision {
  if (ctx.userId === null) return deny("not_authenticated", "Sign in to continue.");
  if (ctx.orgRole === null) return deny("not_org_member", "You are not a member of this organization.");
  return ALLOW;
}

// ---- Tasks ------------------------------------------------------------------

/**
 * Delete a task.
 * Backend: TaskService.Delete → authorize() checks workspace membership only
 * (server/internal/service/task.go:165); the creator is not consulted. Any
 * member may delete. `task` is accepted so a future ownership rule is a
 * one-line change here and nowhere else.
 */
export function canDeleteTask(_task: Task | null, ctx: PermissionContext): Decision {
  return requireWorkspaceMember(ctx) ?? ALLOW;
}

/**
 * Edit a task. Backend: TaskService.Update → authorize(), membership only
 * (server/internal/service/task.go:124).
 */
export function canEditTask(_task: Task | null, ctx: PermissionContext): Decision {
  return requireWorkspaceMember(ctx) ?? ALLOW;
}

// ---- Meetings -----------------------------------------------------------------

/**
 * Delete a meeting. Backend: MeetingService.Delete → authorize(), membership
 * only (server/internal/service/meeting.go).
 */
export function canDeleteMeeting(ctx: PermissionContext): Decision {
  return requireWorkspaceMember(ctx) ?? ALLOW;
}

// ---- Comments (policy; not wired to Tasks UI yet) ---------------------------

/**
 * Edit a comment: author or effective owner/admin.
 * Spec: docs/superpowers/specs/2026-08-27-workspace-permissions-design.md
 */
export function canEditComment(authorId: string | null, ctx: PermissionContext): Decision {
  const gate = requireWorkspaceMember(ctx);
  if (gate) return gate;
  if (authorId && ctx.userId === authorId) return ALLOW;
  if (isAdminLike(ctx.wsRole)) return ALLOW;
  return deny("not_resource_owner", "You can only edit your own comments.");
}

/** Same gate as canEditComment (author or admin-like moderation). */
export function canDeleteComment(authorId: string | null, ctx: PermissionContext): Decision {
  return canEditComment(authorId, ctx);
}

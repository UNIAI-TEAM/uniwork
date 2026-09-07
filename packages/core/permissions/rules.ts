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

/**
 * Create or edit the organization's agents.
 * Backend: AgentService.Create / Update — `!adminLikeRole(m.Role)` on the
 * organization membership → 403 (server/internal/service/agent.go;
 * OPEN_QUESTIONS AG2). Update also allows the agent's owner_user_id, which
 * this rule cannot see and so does not mirror — the button stays admin-only.
 */
export function canManageAgents(ctx: PermissionContext): Decision {
  if (ctx.userId === null) return deny("not_authenticated", "Sign in to continue.");
  if (ctx.orgRole === null) return deny("not_member", "You are not a member of this organization.");
  if (isAdminLike(ctx.orgRole)) return ALLOW;
  return deny("not_admin_role", "Only organization owners and admins can manage agents.");
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

// ---- Billing ----------------------------------------------------------------

/**
 * See the organization's plan, entitlements and usage.
 * Backend: BillingService.Current only needs organization membership
 * (server/internal/service/billing.go); the tab is shown to owners and
 * admins, who are the ones who act on it — a member sees the quota error
 * where it happens instead.
 */
export function canViewBilling(ctx: PermissionContext): Decision {
  if (ctx.userId === null) return deny("not_authenticated", "Sign in to continue.");
  if (ctx.orgRole === null) return deny("not_org_member", "You are not a member of this organization.");
  if (isAdminLike(ctx.orgRole)) return ALLOW;
  return deny("not_admin_role", "Only organization owners and admins can see billing.");
}

/**
 * Change, cancel or resume the plan, or open a checkout.
 * Backend: BillingService.requireOwner — `m.Role != "owner"` → 403 unless the
 * user is platform staff, which this rule cannot see (server/internal/service/billing.go).
 */
export function canManageBilling(ctx: PermissionContext): Decision {
  const gate = canViewBilling(ctx);
  if (!gate.allowed) return gate;
  if (ctx.orgRole === "owner") return ALLOW;
  return deny("not_owner_role", "Only the organization owner can change the plan.");
}

// ---- Audit ------------------------------------------------------------------

/**
 * Read the organization-wide audit log.
 * Backend: AuditService.RequireOrgAdmin — owner and admin only
 * (server/internal/service/audit_service.go).
 */
export function canReadAuditLog(ctx: PermissionContext): Decision {
  if (ctx.userId === null) return deny("not_authenticated", "Sign in to continue.");
  if (ctx.orgRole === null) return deny("not_org_member", "You are not a member of this organization.");
  if (isAdminLike(ctx.orgRole)) return ALLOW;
  return deny("not_admin_role", "Only organization owners and admins can read the audit log.");
}

/**
 * Change the retention window, or ask for an export.
 * Backend: AuditService.SetRetention and RequestExport both require
 * `m.Role != "owner"` → 403. Shortening retention destroys evidence later and
 * an export takes the log out of the system; neither is an admin's to do.
 */
export function canManageAuditSettings(ctx: PermissionContext): Decision {
  const gate = canReadAuditLog(ctx);
  if (!gate.allowed) return gate;
  if (ctx.orgRole === "owner") return ALLOW;
  return deny("not_owner_role", "Only the organization owner can change retention or export the log.");
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

export function canDeleteMeeting(
  meeting: { host_user_id?: string } | null,
  ctx: PermissionContext,
): Decision {
  const gate = requireWorkspaceMember(ctx);
  if (gate) return gate;
  if (isAdminLike(ctx.wsRole)) return ALLOW;
  if (meeting && ctx.userId && meeting.host_user_id === ctx.userId) return ALLOW;
  return deny("not_resource_owner", "Only the host or a workspace admin can cancel this meeting.");
}

export function canHostMeeting(
  meeting: { host_user_id?: string } | null,
  ctx: PermissionContext,
): Decision {
  return canDeleteMeeting(meeting, ctx);
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

// ---- Organization & People (F-03) ----------------------------------------

/**
 * The gate every organization rule starts with. A deactivated member keeps
 * their role but may do nothing at all, so this is checked before the role is.
 * Backend: OrganizationService.RequireMember returns 403 member_deactivated
 * ahead of every other decision (server/internal/service/organization.go).
 */
function requireActiveOrgMember(ctx: PermissionContext): Decision | null {
  if (ctx.userId === null) return deny("not_authenticated", "Sign in to continue.");
  if (ctx.orgRole === null) return deny("not_org_member", "You are not a member of this organization.");
  if (ctx.orgMemberStatus === "deactivated") {
    return deny("member_deactivated", "Your account in this organization has been deactivated.");
  }
  return null;
}

function requireOrgAdmin(ctx: PermissionContext, message: string): Decision {
  const gate = requireActiveOrgMember(ctx);
  if (gate) return gate;
  if (isAdminLike(ctx.orgRole)) return ALLOW;
  return deny("not_admin_role", message);
}

/**
 * Edit a profile. A person owns what they say about themselves; the company
 * owns department, manager, employee code and start date.
 * Backend: PeopleService.UpdateProfile — 403 for someone else's profile
 * without admin, and 403 for an admin-only field either way
 * (server/internal/service/people.go).
 */
export function canEditProfile(
  target: { user_id: string } | null,
  ctx: PermissionContext,
): Decision {
  const gate = requireActiveOrgMember(ctx);
  if (gate) return gate;
  if (target && target.user_id === ctx.userId) return ALLOW;
  if (isAdminLike(ctx.orgRole)) return ALLOW;
  return deny("not_resource_owner", "You can only edit your own profile.");
}

/**
 * Edit the fields the company asserts about a person, as opposed to the ones
 * the person asserts about themselves (OPEN_QUESTIONS P8).
 * Backend: PeopleService.UpdateProfile — ProfileInput.adminOnly() → 403.
 */
export function canEditEmploymentFields(ctx: PermissionContext): Decision {
  return requireOrgAdmin(ctx, "Only organization owners and admins can set department, manager, employee code or start date.");
}

/**
 * Invite, change roles, deactivate and reactivate.
 * Backend: OrganizationMemberService.requireAdmin
 * (server/internal/service/organization_members.go).
 */
export function canManageOrgMembers(ctx: PermissionContext): Decision {
  return requireOrgAdmin(ctx, "Only organization owners and admins can manage members.");
}

/**
 * Change one member's organization role. Ownership is not a role change, and
 * nobody changes their own role.
 * Backend: OrganizationMemberService.UpdateRole — owner target → 409
 * last_owner; self → 400 cannot_change_own_role.
 */
export function canChangeOrgRole(
  target: { user_id: string; role: string } | null,
  ctx: PermissionContext,
): Decision {
  const gate = canManageOrgMembers(ctx);
  if (!gate.allowed) return gate;
  if (!target) return gate;
  if (target.user_id === ctx.userId) return deny("not_resource_owner", "You cannot change your own role.");
  if (target.role === "owner") {
    return deny("last_owner", "The owner's role changes by transferring ownership.");
  }
  return ALLOW;
}

/**
 * Deactivate one member. The owner is never a target, nobody deactivates
 * themselves, and only the owner may deactivate an admin (OPEN_QUESTIONS P6).
 * Backend: OrganizationMemberService.Deactivate.
 */
export function canDeactivateMember(
  target: { user_id: string; role: string } | null,
  ctx: PermissionContext,
): Decision {
  const gate = canManageOrgMembers(ctx);
  if (!gate.allowed) return gate;
  if (!target) return gate;
  if (target.user_id === ctx.userId) return deny("not_resource_owner", "You cannot deactivate yourself.");
  if (target.role === "owner") return deny("last_owner", "The owner cannot be deactivated.");
  if (target.role === "admin" && ctx.orgRole !== "owner") {
    return deny("not_owner_role", "Only the organization owner can deactivate an admin.");
  }
  return ALLOW;
}

/**
 * Hand the organization to someone else.
 * Backend: OrganizationMemberService.TransferOwnership — owner only.
 */
export function canTransferOwnership(ctx: PermissionContext): Decision {
  const gate = requireActiveOrgMember(ctx);
  if (gate) return gate;
  if (ctx.orgRole === "owner") return ALLOW;
  return deny("not_owner_role", "Only the organization owner can transfer ownership.");
}

/**
 * Leave the organization. The owner transfers ownership first.
 * Backend: OrganizationMemberService.Leave — owner → 409 last_owner.
 */
export function canLeaveOrg(ctx: PermissionContext): Decision {
  const gate = requireActiveOrgMember(ctx);
  if (gate) return gate;
  if (ctx.orgRole === "owner") {
    return deny("last_owner", "Transfer ownership before leaving the organization.");
  }
  return ALLOW;
}

/**
 * Create, rename and archive departments.
 * Backend: DepartmentService.requireAdmin (server/internal/service/department.go).
 */
export function canManageDepartments(ctx: PermissionContext): Decision {
  return requireOrgAdmin(ctx, "Only organization owners and admins can manage departments.");
}

/**
 * Take a copy of the directory. Reading it is open to every member; exporting
 * it is not.
 * Backend: PeopleService.RequireExporter (server/internal/service/people.go).
 */
export function canExportPeople(ctx: PermissionContext): Decision {
  return requireOrgAdmin(ctx, "Only organization owners and admins can export the directory.");
}

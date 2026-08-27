/**
 * Public API for the permissions module. Only what views consume is exported;
 * the full rule set in ./rules is reachable by tests and future surfaces
 * directly. Add to this list only when there is a caller.
 */
export type { Decision, DecisionReason, PermissionContext } from "./types";
export { canCreateWorkspaceInOrg, canDeleteTask, canInviteMembers, canUpdateWorkspaceSettings } from "./rules";
export { useCurrentMember, useOrgMembership } from "./use-current-member";
export { useOrgPermissions, useTaskPermissions, useWorkspacePermissions } from "./use-resource-permissions";

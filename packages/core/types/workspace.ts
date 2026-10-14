import { z } from "zod";

export const WorkspaceSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  organization_id: z.string(),
  organization_slug: z.string(),
  organization_name: z.string(),
});
export type Workspace = z.infer<typeof WorkspaceSchema>;

export const MEMBER_ROLES = ["owner", "admin", "member"] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

export const WorkspaceMembershipSchema = z.object({
  user_id: z.string(),
  role: z.string(),
  source: z.string(),
});
export type WorkspaceMembership = {
  user_id: string;
  role: string;
  source: string;
};

export const MemberSchema = z.object({
  workspace_id: z.string(),
  user_id: z.string(),
  // Lenient on the wire — see organization.ts. `Member["role"]` is typed as
  // the known union below; an unknown value is handled by permissions as the
  // least privileged role.
  role: z.string(),
  email: z.string(),
  display_name: z.string(),
  avatar_url: z.unknown().optional(),
});
export type Member = Omit<z.infer<typeof MemberSchema>, "role"> & { role: MemberRole };

const InvitationWorkspaceRefSchema = z.object({ id: z.string(), slug: z.string(), name: z.string() });
export type InvitationWorkspaceRef = z.infer<typeof InvitationWorkspaceRefSchema>;

/**
 * Every workspace accepting an invitation grants (UNI-1582): the one it was
 * sent from, or the ones an admin picked for an organization invitation.
 * Absent from older servers, and a drifted list reads as none rather than
 * costing the whole response.
 */
const InvitationWorkspacesSchema = z.array(InvitationWorkspaceRefSchema).default([]).catch([]);

export const PendingInvitationSchema = z.object({
  id: z.string(),
  role: z.string(),
  token: z.string(),
  expires_at: z.string(),
  /** The organization role accepting grants; absent from older servers, read as the least privileged. */
  org_role: z.string().default("member"),
  /** Absent for an invitation to the organization itself (F-03): the server omits the key. */
  workspace: z.object({ id: z.string(), slug: z.string(), name: z.string() }).optional(),
  workspaces: InvitationWorkspacesSchema,
  organization: z.object({ id: z.string(), slug: z.string(), name: z.string() }),
  invited_by: z.object({ display_name: z.string() }),
});
export type PendingInvitation = z.infer<typeof PendingInvitationSchema>;

/**
 * Where accepting an invitation leads: its `workspaces`, or - from a server
 * that only names the workspace an invitation was sent from - that one.
 */
export function invitationWorkspaces(
  invitation: Pick<PendingInvitation, "workspace"> & { workspaces?: InvitationWorkspaceRef[] },
): InvitationWorkspaceRef[] {
  // Optional here: a record built outside the schema (a cache seeded by hand)
  // may not carry the key.
  if (invitation.workspaces?.length) return invitation.workspaces;
  return invitation.workspace ? [invitation.workspace] : [];
}

const InvitationOrgRefSchema = z.object({ id: z.string(), slug: z.string(), name: z.string() });

/**
 * One organization the caller already belongs to that stands between them and
 * an invitation (ADR 0032), with what it takes to give it up. The preview and
 * the 409 organization_switch_required carry the same shape. Lenient like
 * every response schema: an action this client does not know still parses,
 * and every switch over it carries a default.
 */
export const MembershipConflictSchema = z.object({
  organization: InvitationOrgRefSchema,
  role: z.string(),
  /** leave | transfer | close | blocked */
  required_action: z.string(),
  /** owner_of_suspended_organization, only with required_action blocked. */
  blocked_reason: z.string().optional(),
  transfer_candidates_count: z.number().default(0),
});
export type MembershipConflict = z.infer<typeof MembershipConflictSchema>;

/**
 * GET /api/v1/invitations/{token}: the invitation in any state, as its invitee
 * sees it. `conflicts` is empty unless the invitation is pending.
 */
export const InvitationPreviewSchema = z.object({
  invitation: z.object({
    id: z.string(),
    /** pending | expired | revoked | accepted */
    status: z.string(),
    expires_at: z.string(),
    organization: InvitationOrgRefSchema,
    /** Absent for an invitation to the organization itself. */
    workspace: InvitationOrgRefSchema.optional(),
    workspaces: InvitationWorkspacesSchema,
    org_role: z.string().default("member"),
    /** Omitted when the inviter has no display name. */
    inviter_name: z.string().optional(),
  }),
  conflicts: z.array(MembershipConflictSchema).default([]),
});
export type InvitationPreview = z.infer<typeof InvitationPreviewSchema>;

/** How the caller gives up one organization when accepting an invitation into another. */
export type SwitchResolution = {
  organization_id: string;
  action: "leave" | "transfer" | "close";
  transfer_to_user_id?: string;
  password?: string;
  confirm_slug?: string;
};

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

export const PendingInvitationSchema = z.object({
  id: z.string(),
  role: z.string(),
  token: z.string(),
  expires_at: z.string(),
  workspace: z.object({ id: z.string(), slug: z.string(), name: z.string() }),
  organization: z.object({ id: z.string(), slug: z.string(), name: z.string() }),
  invited_by: z.object({ display_name: z.string() }),
});
export type PendingInvitation = z.infer<typeof PendingInvitationSchema>;

import { z } from "zod";

/**
 * Organization & People (F-03). Every schema here is lenient the way
 * `docs/api-sdi-sdo.md` requires: server enums arrive as `z.string()` and the
 * exported types narrow them, so a role this client predates renders as text
 * instead of throwing the whole directory away.
 */

export const ACTOR_KINDS = ["human", "agent", "system"] as const;
export type ActorKind = (typeof ACTOR_KINDS)[number];

export const ActorSchema = z.object({
  id: z.string(),
  kind: z.string(),
  display_name: z.string(),
  avatar_url: z.string().optional(),
});
export type Actor = z.infer<typeof ActorSchema>;

export const DepartmentRefSchema = z.object({ id: z.string(), name: z.string() });
export type DepartmentRef = z.infer<typeof DepartmentRefSchema>;

export const ORG_MEMBER_STATUSES = ["active", "deactivated"] as const;
export type OrgMemberStatus = (typeof ORG_MEMBER_STATUSES)[number];

/** One entry of the directory. `phone` is absent unless its owner published it. */
export const PersonSchema = z.object({
  user_id: z.string(),
  display_name: z.string(),
  email: z.string(),
  avatar_url: z.string().optional(),
  org_role: z.string(),
  status: z.string(),
  title: z.string().default(""),
  department: DepartmentRefSchema.nullish(),
  manager: ActorSchema.nullish(),
  employee_code: z.string().optional(),
  phone: z.string().optional(),
  phone_visible: z.boolean().default(false),
  location: z.string().optional(),
  bio: z.string().optional(),
  joined_on: z.string().optional(),
  timezone: z.string().default(""),
  deactivated_at: z.string().optional(),
  is_self: z.boolean().default(false),
});
export type Person = z.infer<typeof PersonSchema>;

export const DepartmentSchema = z.object({
  id: z.string(),
  name: z.string(),
  code: z.string().optional(),
  parent_id: z.string().optional(),
  head: ActorSchema.nullish(),
  member_count: z.number().default(0),
  sort_order: z.number().default(0),
  archived_at: z.string().optional(),
});
export type Department = z.infer<typeof DepartmentSchema>;

/** One membership row of the organization, without the profile fields. */
export const OrgMemberSchema = z.object({
  user_id: z.string(),
  email: z.string().default(""),
  display_name: z.string().default(""),
  avatar_url: z.string().optional(),
  role: z.string(),
  deactivated_at: z.string().optional(),
  invited_by: z.string().optional(),
  created_at: z.string().default(""),
});
export type OrgMember = z.infer<typeof OrgMemberSchema>;

/** The caller's own standing in an organization, read before any screen. */
export const OrgMembershipSchema = z.object({
  role: z.string(),
  deactivated_at: z.string().optional(),
  platform_role: z.string().optional(),
});
export type OrgMembership = z.infer<typeof OrgMembershipSchema>;

/** Filters the directory screen puts in the query string. */
export interface PeopleFilters {
  q?: string;
  department_id?: string;
  manager_id?: string;
  role?: string;
  status?: string;
}

/** A partial profile edit; an absent field is left alone by the server. */
export interface ProfileInput {
  title?: string;
  department_id?: string;
  manager_id?: string;
  employee_code?: string;
  phone?: string;
  phone_visible?: boolean;
  location?: string;
  bio?: string;
  joined_on?: string;
}

export interface DepartmentInput {
  name?: string;
  code?: string;
  parent_id?: string;
  head_user_id?: string;
}

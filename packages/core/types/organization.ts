import { z } from "zod";

export const OrganizationSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  // The caller's role in the organization. Lenient string: an unknown role
  // must still parse — permissions treat anything unrecognised as "member".
  role: z.string().optional(),
  /** active | suspended | archived; absent on older servers. */
  status: z.string().optional(),
  /** The caller's membership was switched off; absent when it is live. */
  deactivated: z.boolean().optional(),
});
export type Organization = z.infer<typeof OrganizationSchema>;

/**
 * Whether the caller still belongs to the organization (ADR 0032 D1): a live
 * membership in an organization that is not archived. Suspended still counts,
 * so a suspension cannot be used to slip past the one-organization rule.
 */
export function holdsOrganization(org: Pick<Organization, "status" | "deactivated">): boolean {
  return org.deactivated !== true && org.status !== "archived";
}

export const ORG_ROLES = ["owner", "admin", "member"] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

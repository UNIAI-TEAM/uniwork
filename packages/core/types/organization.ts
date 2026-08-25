import { z } from "zod";

export const OrganizationSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  // The caller's role in the organization. Lenient string: an unknown role
  // must still parse — permissions treat anything unrecognised as "member".
  role: z.string().optional(),
});
export type Organization = z.infer<typeof OrganizationSchema>;

export const ORG_ROLES = ["owner", "admin", "member"] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

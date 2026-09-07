import type { AdminOrganizationQuery } from "../api/endpoints/admin";

/**
 * Query keys for the platform-admin console. Nothing here is workspace
 * scoped: the console sits outside every organization, so the keys carry the
 * organization id only where the data is about one.
 */
export const adminKeys = {
  root: ["admin"] as const,
  me: ["admin", "me"] as const,
  organizationsRoot: ["admin", "organizations"] as const,
  organizations: (query: AdminOrganizationQuery) => ["admin", "organizations", query] as const,
  organization: (orgId: string) => ["admin", "organization", orgId] as const,
  trace: (traceId: string) => ["admin", "trace", traceId] as const,
  system: ["admin", "system"] as const,
  flags: ["admin", "flags"] as const,
  overrides: (key: string) => ["admin", "flags", key, "overrides"] as const,
  allOverrides: ["admin", "flags", "overrides"] as const,
};

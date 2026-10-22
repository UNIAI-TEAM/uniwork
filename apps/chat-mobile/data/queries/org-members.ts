// The organization's members, read by status. The deactivated ones are whom the contacts tab leaves out (a
// workspace row outlives deactivation and ResolveDM refuses them), as the web's member picker does; the active ones
// are whom an owner deleting the account can hand the organization to (components/settings/delete-account.tsx). The
// workspace's members and the viewer's nicknames, the contacts tab's other two sources, are chat resources: chatApi
// reads them under chatKeys (data/queries/chat.ts), the one module and key of each.
import { queryOptions } from "@tanstack/react-query";
import { parseWithFallback } from "@uniwork/core/api/schema";
import { z } from "zod";
import type { OrgMemberRow } from "@/lib/owner-transfer";
import { api } from "../api";

const enc = encodeURIComponent;

/** The organization tier's keys; an org slug, not a workspace id, scopes them. */
const orgMemberKeys = {
  deactivated: (orgSlug: string) => ["org", orgSlug, "deactivated-members"] as const,
  active: (orgSlug: string) => ["org", orgSlug, "active-members"] as const,
};

/** One row of GET /api/v1/orgs/{org}/members (sdo.OrgMemberDTO); a row without an id is dropped, the rest default. */
export const OrgMemberRowSchema = z.object({
  user_id: z.string(),
  display_name: z.string().catch(""),
  email: z.string().catch(""),
  role: z.string().catch(""),
  deactivated_at: z.string().nullish().catch(null),
});

export const OrgMembersPageSchema = z.object({
  members: z
    .array(OrgMemberRowSchema.nullable().catch(null))
    .transform((rows) => rows.filter((r): r is OrgMemberRow => r !== null)),
  next_cursor: z.string().optional().catch(undefined),
});

// shortcut: 10 pages of 100 people are read at most; past that some are left out, as on the web.
const MAX_PAGES = 10;

async function fetchMembers(orgSlug: string, status: "active" | "deactivated", signal?: AbortSignal): Promise<OrgMemberRow[]> {
  const rows: OrgMemberRow[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const after = cursor ? `&cursor=${enc(cursor)}` : "";
    const raw = await api.request(`/api/v1/orgs/${enc(orgSlug)}/members?status=${status}&limit=100${after}`, { signal });
    const parsed = parseWithFallback<z.infer<typeof OrgMembersPageSchema>>(raw, OrgMembersPageSchema, { members: [] }, {
      endpoint: "GET /api/v1/orgs/{org}/members",
    });
    rows.push(...parsed.members);
    cursor = parsed.next_cursor;
    if (!cursor) break;
  }
  return rows;
}

export async function fetchDeactivatedUserIds(orgSlug: string, signal?: AbortSignal): Promise<string[]> {
  return (await fetchMembers(orgSlug, "deactivated", signal)).map((m) => m.user_id);
}

export const deactivatedMembersOptions = (orgSlug: string) =>
  queryOptions({
    queryKey: orgMemberKeys.deactivated(orgSlug),
    queryFn: ({ signal }) => fetchDeactivatedUserIds(orgSlug, signal),
  });

/** The organization's active members, the owner among them (lib/owner-transfer.ts › transferCandidates leaves them out). */
export const activeMembersOptions = (orgSlug: string) =>
  queryOptions({
    queryKey: orgMemberKeys.active(orgSlug),
    queryFn: ({ signal }) => fetchMembers(orgSlug, "active", signal),
  });

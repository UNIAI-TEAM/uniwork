// The organization's deactivated people, whom the contacts tab leaves out (a
// workspace row outlives deactivation and ResolveDM refuses them), as the
// web's member picker does. The workspace's members and the viewer's
// nicknames, the tab's other two sources, are chat resources: chatApi reads
// them under chatKeys (data/queries/chat.ts), the one module and key of each.
import { queryOptions } from "@tanstack/react-query";
import { parseWithFallback } from "@uniwork/core/api/schema";
import { z } from "zod";
import { api } from "../api";

const enc = encodeURIComponent;

/** The organization tier's keys; an org slug, not a workspace id, scopes them. */
export const orgMemberKeys = {
  deactivated: (orgSlug: string) => ["org", orgSlug, "deactivated-members"] as const,
};

const OrgMembersPageSchema = z.object({
  members: z
    .array(z.object({ user_id: z.string() }).nullable().catch(null))
    .transform((rows) => rows.filter((r): r is { user_id: string } => r !== null)),
  next_cursor: z.string().optional().catch(undefined),
});

// shortcut: 10 pages of 100 deactivated people are read at most; past that some show, as on the web.
const MAX_DEACTIVATED_PAGES = 10;

export async function fetchDeactivatedUserIds(orgSlug: string, signal?: AbortSignal): Promise<string[]> {
  const ids: string[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_DEACTIVATED_PAGES; page++) {
    const after = cursor ? `&cursor=${enc(cursor)}` : "";
    const raw = await api.request(`/api/v1/orgs/${enc(orgSlug)}/members?status=deactivated&limit=100${after}`, { signal });
    const parsed = parseWithFallback<z.infer<typeof OrgMembersPageSchema>>(raw, OrgMembersPageSchema, { members: [] }, {
      endpoint: "GET /api/v1/orgs/{org}/members",
    });
    ids.push(...parsed.members.map((m) => m.user_id));
    cursor = parsed.next_cursor;
    if (!cursor) break;
  }
  return ids;
}

export const deactivatedMembersOptions = (orgSlug: string) =>
  queryOptions({
    queryKey: orgMemberKeys.deactivated(orgSlug),
    queryFn: ({ signal }) => fetchDeactivatedUserIds(orgSlug, signal),
  });

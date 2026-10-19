// The contacts tab's sources, each one the web reads: the workspace members
// (GET /workspaces/{ws}/members, the member picker's list), the organization's
// deactivated people to leave out (a workspace row outlives deactivation and
// ResolveDM refuses them) and the viewer's nicknames (normalised like core
// api/endpoints/chat-users.ts › listChatNicknames). Who is online comes from
// the chat tab's presence store, which the workspace's one heartbeat feeds
// (data/realtime/use-chat-realtime.ts).
import { queryOptions } from "@tanstack/react-query";
import { parseWithFallback } from "@uniwork/core/api/schema";
import { z } from "zod";
import type { ContactMember } from "@/lib/contacts-display";
import { api } from "../api";

const enc = encodeURIComponent;

/** a row that does not parse is dropped, not the list */
const lenientRows = <T extends z.ZodType>(row: T) =>
  z.array(row.nullable().catch(null)).transform((rows) => rows.filter((r): r is z.infer<T> => r !== null));

const MembersSchema = z.object({
  members: lenientRows(
    z.object({
      user_id: z.string(),
      email: z.string().catch(""),
      display_name: z.string().catch(""),
      avatar_url: z.string().optional().catch(undefined),
    }),
  ),
});

const OrgMembersPageSchema = z.object({
  members: lenientRows(z.object({ user_id: z.string() })),
  next_cursor: z.string().optional().catch(undefined),
});

const NicknamesSchema = z.object({ nicknames: z.record(z.string(), z.unknown()).catch({}) });

// shortcut: 10 pages of 100 deactivated people are read at most; past that some show, as on the web.
const MAX_DEACTIVATED_PAGES = 10;

export async function fetchWorkspaceMembers(wsId: string, signal?: AbortSignal): Promise<ContactMember[]> {
  const raw = await api.request(`/api/v1/workspaces/${enc(wsId)}/members`, { signal });
  return parseWithFallback<{ members: ContactMember[] }>(raw, MembersSchema, { members: [] }, {
    endpoint: "GET /api/v1/workspaces/{ws}/members",
  }).members;
}

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

export async function fetchChatNicknames(wsId: string, signal?: AbortSignal): Promise<Record<string, string>> {
  const raw = await api.request(`/api/v1/workspaces/${enc(wsId)}/chat/nicknames`, { signal });
  const parsed = parseWithFallback<{ nicknames: Record<string, unknown> }>(raw, NicknamesSchema, { nicknames: {} }, {
    endpoint: "GET /api/v1/workspaces/{ws}/chat/nicknames",
  });
  const out: Record<string, string> = {};
  for (const [userId, nickname] of Object.entries(parsed.nicknames)) {
    const key = userId.trim().toUpperCase();
    if (key && typeof nickname === "string") out[key] = nickname;
  }
  return out;
}

export const workspaceMembersOptions = (wsId: string) =>
  queryOptions({ queryKey: ["workspace-members", wsId] as const, queryFn: ({ signal }) => fetchWorkspaceMembers(wsId, signal) });

export const deactivatedMembersOptions = (orgSlug: string) =>
  queryOptions({
    queryKey: ["org-deactivated-members", orgSlug] as const,
    queryFn: ({ signal }) => fetchDeactivatedUserIds(orgSlug, signal),
  });

export const chatNicknamesOptions = (wsId: string) =>
  queryOptions({ queryKey: ["chat-nicknames", wsId] as const, queryFn: ({ signal }) => fetchChatNicknames(wsId, signal) });


// The offline copy kept current between opens (audit "push-does-not-hydrate-
// cache" and the frames-for-unshown-rooms miss). A frame for a room nobody
// shows only marks its timeline stale (UNI-1078: one GET per frame for every
// loaded room was too many), and a push never touched the cache, so a room
// the phone was told about could open offline on an older page than the
// inbox's own preview. Two moments now read the newest page once, batched:
//   - a push about a room, received in front or tapped (hydrateFromPush):
//     that room's newest page and its workspace's list, before the person
//     gets there — the workspace may have no socket on this phone;
//   - the app leaving the front (refreshStaleTimelines): the most recent
//     rooms whose cached timeline is behind — marked stale by a frame, older
//     than the list's preview, or never loaded while unread — so the copy the
//     next offline cold start opens on is the one the inbox promises.
// A timeline someone shows is the socket's (chat-realtime.ts) and is left
// alone; one nobody shows is cut back to its newest page first, so the
// refresh is one request. Whatever lands is saved by query-persister.ts.
import type { QueryClient } from "@tanstack/react-query";
import type { ChatRoomRecord } from "@uniwork/core/api/endpoints/chat-schemas";
import { keepRoomTimelineHead, newestTimelineMessage, type RoomTimeline } from "@uniwork/core/chat/room-timeline-pages";
import type { Workspace } from "@uniwork/core/types/workspace";
import { parseDeepLink } from "@/lib/deep-link";
import { roomTimelineOptions, roomsOptions } from "./queries/chat";
import { chatKeys } from "./queries/chat-keys";
import { workspaceKeys } from "./queries/workspaces";

/** The rooms per workspace a background refresh looks at: the ones the disk keeps (query-persister.ts). */
const REFRESHED_ROOMS = 24;

const observed = (qc: QueryClient, queryKey: readonly unknown[]) => (qc.getQueryCache().find({ queryKey, exact: true })?.getObserversCount() ?? 0) > 0;

/**
 * One room's newest page, read once; a timeline on screen is left to the
 * socket. Through the query's options, not a bare refetch: a timeline
 * restored from disk has no queryFn of its own until a screen observes it.
 */
export async function refreshRoomHead(qc: QueryClient, wsId: string, roomId: string): Promise<void> {
  const key = chatKeys.roomMessages(wsId, roomId);
  if (observed(qc, key)) return;
  const data = qc.getQueryData<RoomTimeline>(key);
  if (data) qc.setQueryData<RoomTimeline>(key, keepRoomTimelineHead(data));
  await qc.prefetchInfiniteQuery({ ...roomTimelineOptions(wsId, roomId), staleTime: 0 });
}

const time = (value: string | null | undefined) => Date.parse(value ?? "") || 0;

/** Whether the cached timeline of `room` is behind what the list says. */
function isBehind(qc: QueryClient, wsId: string, room: ChatRoomRecord): boolean {
  const key = chatKeys.roomMessages(wsId, room.id);
  if (observed(qc, key)) return false;
  const state = qc.getQueryState<RoomTimeline>(key);
  if (!state?.data) return room.unread_count > 0;
  if (state.isInvalidated) return true;
  return time(room.last_message_at) > time(newestTimelineMessage(state.data)?.created_at);
}

/** Before the app leaves the front: every recent room whose cached timeline is behind, read once. */
export async function refreshStaleTimelines(qc: QueryClient, limit = REFRESHED_ROOMS): Promise<void> {
  const reads: Promise<void>[] = [];
  for (const [queryKey, rooms] of qc.getQueriesData<ChatRoomRecord[]>({ queryKey: ["chat"] })) {
    const [, wsId, kind] = queryKey;
    if (kind !== "rooms" || queryKey.length !== 3 || typeof wsId !== "string" || !Array.isArray(rooms)) continue;
    const recent = [...rooms].sort((a, b) => time(b.last_message_at) - time(a.last_message_at)).slice(0, limit);
    for (const room of recent) if (isBehind(qc, wsId, room)) reads.push(refreshRoomHead(qc, wsId, room.id));
  }
  await Promise.all(reads);
}

export interface PushLinkEnv {
  appUrl: string;
  scheme: string;
}

/** A push about a room (its `data.url`): the room's newest page and its workspace's list, before the person opens it. */
export async function hydrateFromPush(qc: QueryClient, data: unknown, env: PushLinkEnv): Promise<void> {
  const url: unknown = data !== null && typeof data === "object" ? Reflect.get(data, "url") : undefined;
  const link = typeof url === "string" ? parseDeepLink(url, env.appUrl, env.scheme) : null;
  // A call's push opens a ringing screen, not a timeline.
  if (!link?.roomId || link.callId) return;
  const workspace = qc.getQueryData<Workspace[]>(workspaceKeys.list())?.find((ws) => ws.slug === link.wsSlug && ws.organization_slug === link.orgSlug);
  if (!workspace) return;
  const rooms = chatKeys.rooms(workspace.id);
  // The list is read too: the workspace may have no socket on this phone.
  await Promise.all([
    observed(qc, rooms) ? Promise.resolve() : qc.prefetchQuery({ ...roomsOptions(workspace.id), staleTime: 0 }),
    refreshRoomHead(qc, workspace.id, link.roomId),
  ]);
}

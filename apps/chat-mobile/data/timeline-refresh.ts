// The offline copy kept current between opens. A frame for a room nobody
// shows only marks its timeline stale (one GET per frame for every
// loaded room was too many), and a push never touched the cache, so a room
// the phone was told about could open offline on an older page than the
// inbox's own preview. Two moments now read the newest page once, batched:
//   - a push about a room, received in front or tapped (hydrateFromPush),
//     or reaching a closed Android app's background task
//     (chat-sync/push-prefetch.ts): that room's newest page and its
//     workspace's list (hydrateRoom), before the person gets there — the
//     workspace may have no socket on this phone;
//   - the app leaving the front (refreshStaleTimelines): the most recent
//     rooms whose cached timeline is behind — marked stale by a frame, older
//     than the list's preview, or never loaded while unread — so the copy the
//     next offline cold start opens on is the one the inbox promises.
// A timeline someone shows is the socket's (chat-realtime.ts) and is left
// alone; one nobody shows is cut back to its newest page first, so the
// refresh is one request, and REFRESH_CONCURRENCY run at a time. Whatever
// lands is saved by query-persister.ts.
//
// The list's last_message_at counts thread replies; the timeline does not
// (server/pkg/db/queries/chat.sql: the rooms list's last_msg lateral against
// ListChatMessagesByRoom's thread_root_id IS NULL). A room whose newest
// message is a reply would look behind for ever, so a timeline read against
// one value of the list's time is not read again until that time moves.
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
/** Reads a background refresh runs at once. */
export const REFRESH_CONCURRENCY = 4;

/** Per client: the list's last_message_at each room's timeline was last read against. */
const readAgainst = new WeakMap<QueryClient, Map<string, string>>();

const observed = (qc: QueryClient, queryKey: readonly unknown[]) =>
  (qc.getQueryCache().find({ queryKey, exact: true })?.getObserversCount() ?? 0) > 0;

/**
 * One room's newest page, read once; a timeline on screen is left to the
 * socket. Through the query's options, not a bare refetch: a timeline
 * restored from disk has no queryFn of its own until a screen observes it.
 */
export async function refreshRoomHead(qc: QueryClient, wsId: string, roomId: string): Promise<boolean> {
  const key = chatKeys.roomMessages(wsId, roomId);
  if (observed(qc, key)) return false;
  const data = qc.getQueryData<RoomTimeline>(key);
  if (data) qc.setQueryData<RoomTimeline>(key, keepRoomTimelineHead(data));
  await qc.prefetchInfiniteQuery({ ...roomTimelineOptions(wsId, roomId), staleTime: 0 });
  // A prefetch never throws: the page was read when the query holds no error.
  return qc.getQueryState(key)?.error === null;
}

const time = (value: string | null | undefined) => Date.parse(value ?? "") || 0;

/** Whether the cached timeline of `room` is behind what the list says. */
function isBehind(qc: QueryClient, wsId: string, room: ChatRoomRecord): boolean {
  const key = chatKeys.roomMessages(wsId, room.id);
  if (observed(qc, key)) return false;
  const state = qc.getQueryState<RoomTimeline>(key);
  if (!state?.data) return room.unread_count > 0;
  if (state.isInvalidated) return true;
  if (time(room.last_message_at) <= time(newestTimelineMessage(state.data)?.created_at)) return false;
  // Newer in the list only: a thread reply, unless this time is new since the last read.
  return readAgainst.get(qc)?.get(`${wsId}/${room.id}`) !== room.last_message_at;
}

/** Before the app leaves the front: every recent room whose cached timeline is behind, read once. */
export async function refreshStaleTimelines(qc: QueryClient, limit = REFRESHED_ROOMS): Promise<void> {
  const behind: { wsId: string; room: ChatRoomRecord }[] = [];
  for (const [queryKey, rooms] of qc.getQueriesData<ChatRoomRecord[]>({ queryKey: ["chat"] })) {
    const [, wsId, kind] = queryKey;
    if (kind !== "rooms" || queryKey.length !== 3 || typeof wsId !== "string" || !Array.isArray(rooms)) continue;
    const recent = [...rooms].sort((a, b) => time(b.last_message_at) - time(a.last_message_at)).slice(0, limit);
    for (const room of recent) if (isBehind(qc, wsId, room)) behind.push({ wsId, room });
  }
  const seen = readAgainst.get(qc) ?? new Map<string, string>();
  readAgainst.set(qc, seen);
  const worker = async () => {
    for (let next = behind.shift(); next; next = behind.shift()) {
      const { wsId, room } = next;
      if ((await refreshRoomHead(qc, wsId, room.id)) && room.last_message_at) seen.set(`${wsId}/${room.id}`, room.last_message_at);
    }
  };
  await Promise.all(Array.from({ length: REFRESH_CONCURRENCY }, worker));
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
  const workspace = qc
    .getQueryData<Workspace[]>(workspaceKeys.list())
    ?.find((ws) => ws.slug === link.wsSlug && ws.organization_slug === link.orgSlug);
  if (!workspace) return;
  await hydrateRoom(qc, workspace.id, link.roomId);
}

/**
 * A room a push named: its newest page and its workspace's list, each left alone while a screen shows it. The list
 * is read too: the workspace may have no socket on this phone (chat-sync/push-prefetch.ts reads it for a closed app).
 */
export async function hydrateRoom(qc: QueryClient, wsId: string, roomId: string): Promise<void> {
  const rooms = chatKeys.rooms(wsId);
  await Promise.all([
    observed(qc, rooms) ? Promise.resolve() : qc.prefetchQuery({ ...roomsOptions(wsId), staleTime: 0 }),
    refreshRoomHead(qc, wsId, roomId),
  ]);
}

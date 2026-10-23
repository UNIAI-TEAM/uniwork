// Query options for the chat tab, mirroring the web's hooks in
// packages/core/chat/{chat-hooks-rooms,thread-hooks}.ts as plain option
// factories (the screens call useQuery / useInfiniteQuery with them).
import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import { chatApi } from "../chat-api";
import {
  CHAT_HISTORY_PAGE_SIZE,
  compareMessages,
  flattenRoomTimeline,
  olderRoomPageParam,
  type RoomMessagesPageParam,
} from "@uniwork/core/chat/room-timeline-pages";
import { chatKeys } from "./chat-keys";

export const roomsOptions = (wsId: string) =>
  queryOptions({
    queryKey: chatKeys.rooms(wsId),
    queryFn: ({ signal }) => chatApi.listRooms(wsId, signal),
    // A reconnect after a server restart must not keep a briefly empty list.
    refetchOnReconnect: "always",
  });

export const unreadSummaryOptions = () =>
  queryOptions({
    queryKey: chatKeys.unreadSummary(),
    queryFn: ({ signal }) => chatApi.unreadSummary(signal),
    refetchOnReconnect: "always",
  });

/**
 * One room's timeline (H4): older pages chain from the newest by cursor. The
 * list never advances the read pointer itself (mark_read=0); the screen marks
 * the room read on open and at the newest message, as the web does.
 */
export const roomTimelineOptions = (wsId: string, roomId: string) =>
  infiniteQueryOptions({
    queryKey: chatKeys.roomMessages(wsId, roomId),
    queryFn: ({ pageParam, signal }) =>
      chatApi.listMessages(wsId, roomId, { ...(pageParam ?? {}), limit: CHAT_HISTORY_PAGE_SIZE, markRead: false }, signal),
    initialPageParam: null as RoomMessagesPageParam,
    getNextPageParam: (lastPage, allPages, lastPageParam) => olderRoomPageParam(lastPage, allPages, lastPageParam, CHAT_HISTORY_PAGE_SIZE),
    select: flattenRoomTimeline,
    staleTime: 5_000,
    refetchOnReconnect: "always",
  });

/** The page around one message, for a deep link or a reply quote that jumps out of the loaded window. */
export const roomAroundOptions = (wsId: string, roomId: string, messageId: string) =>
  queryOptions({
    queryKey: chatKeys.roomMessagesAround(wsId, roomId, messageId),
    queryFn: () => chatApi.listMessagesAround(wsId, roomId, messageId),
    staleTime: 30_000,
  });

/** A thread: the first page is the root then the newest replies; older pages chain from the oldest reply. */
export const threadTimelineOptions = (wsId: string, roomId: string, rootId: string) =>
  infiniteQueryOptions({
    queryKey: chatKeys.threadMessages(wsId, roomId, rootId),
    queryFn: ({ pageParam }) => chatApi.listThreadMessages(wsId, roomId, rootId, { ...(pageParam ?? {}), limit: CHAT_HISTORY_PAGE_SIZE }),
    initialPageParam: null as RoomMessagesPageParam,
    // The root heads the first page and is older than every reply: page from the replies only.
    getNextPageParam: (lastPage, allPages, lastPageParam) =>
      olderRoomPageParam(
        lastPage.filter((message) => message.thread_root_id),
        allPages,
        lastPageParam,
        CHAT_HISTORY_PAGE_SIZE,
      ),
    select: (data) => flattenRoomTimeline(data).sort(compareMessages),
  });

export const roomMembersOptions = (wsId: string, roomId: string) =>
  queryOptions({ queryKey: chatKeys.roomMembers(wsId, roomId), queryFn: () => chatApi.listRoomMembers(wsId, roomId) });

export const nicknamesOptions = (wsId: string) =>
  queryOptions({ queryKey: chatKeys.nicknames(wsId), queryFn: () => chatApi.listNicknames(wsId), staleTime: 5 * 60_000 });

/** the follow-ups a message's sheet looks itself up in (the web's follow-ups sheet lists the same). */
export const followUpsOptions = (wsId: string) =>
  queryOptions({ queryKey: chatKeys.followUps(wsId), queryFn: () => chatApi.listFollowUps(wsId, true), staleTime: 30_000 });

/**
 * which messages of one window carry a task (chat-message-links-context). The screen asks once per
 * window of lib/link-windows.ts, so a new message refetches the newest window only.
 */
export const roomLinksOptions = (wsId: string, roomId: string, messageIds: readonly string[]) =>
  queryOptions({
    queryKey: chatKeys.roomLinks(wsId, roomId, messageIds),
    queryFn: () => chatApi.listRoomMessageLinks(wsId, roomId, [...messageIds]),
    enabled: messageIds.length > 0,
    staleTime: 30_000,
    // No keepPreviousData: useQueries gives a window whose key changed a new observer with nothing to
    // keep, so the screen keeps that window's cards itself (lib/link-windows.ts › taskIdsByMessage).
  });

export const taskOptions = (wsId: string, taskId: string) =>
  queryOptions({ queryKey: chatKeys.task(wsId, taskId), queryFn: () => chatApi.getTask(taskId), staleTime: 60_000 });

/** Stickers or GIFs for the picker: trending, or a search once the query has text. */
export const expressionsOptions = (wsId: string, kind: "stickers" | "gifs", q: string) =>
  queryOptions({
    queryKey: chatKeys.expressions(wsId, kind, q.trim()),
    queryFn: () => chatApi.listExpressions(wsId, kind, q),
    staleTime: 5 * 60_000,
  });

export const workspaceMembersOptions = (wsId: string) =>
  queryOptions({ queryKey: chatKeys.members(wsId), queryFn: () => chatApi.listWorkspaceMembers(wsId), staleTime: 5 * 60_000 });

export const myChannelsOptions = (wsId: string) =>
  queryOptions({ queryKey: chatKeys.myChannels(wsId), queryFn: () => chatApi.listChannels(wsId, "mine") });

export const sharedSummaryOptions = (wsId: string, roomId: string) =>
  queryOptions({ queryKey: chatKeys.sharedSummary(wsId, roomId), queryFn: ({ signal }) => chatApi.sharedSummary(wsId, roomId, signal) });

export const discoverableChannelsOptions = (wsId: string) =>
  queryOptions({ queryKey: chatKeys.discoverableChannels(wsId), queryFn: () => chatApi.listChannels(wsId, "discoverable") });

/** Search inside one room; asks nothing below two characters, as the web. */
export const roomSearchOptions = (wsId: string, roomId: string, q: string) =>
  queryOptions({
    queryKey: chatKeys.roomSearch(wsId, roomId, q.trim()),
    queryFn: () => chatApi.searchMessages(wsId, roomId, q.trim()),
    enabled: q.trim().length >= 2,
    staleTime: 30_000,
  });

/** The last few messages of a room for a list row's long-press preview: read-only, it never marks the room read. */
export const roomPreviewOptions = (wsId: string, roomId: string, limit: number) =>
  queryOptions({
    queryKey: chatKeys.roomPreview(wsId, roomId),
    queryFn: ({ signal }) => chatApi.listMessages(wsId, roomId, { limit, markRead: false }, signal),
    enabled: roomId !== "",
    staleTime: 10_000,
  });

/** Whether a live call is being recorded, asked every `intervalMs` while it is on screen. */
export const callRecordingOptions = (wsId: string, roomId: string, callId: string, intervalMs: number) =>
  queryOptions({
    queryKey: chatKeys.callRecording(wsId, roomId, callId),
    queryFn: () => chatApi.callRecordingActive(wsId, roomId, callId),
    enabled: wsId !== "" && roomId !== "" && callId !== "",
    refetchInterval: intervalMs,
  });

// Query options for the chat tab, mirroring the web's hooks in
// packages/core/chat/{chat-hooks-rooms,thread-hooks}.ts as plain option
// factories (the screens call useQuery / useInfiniteQuery with them).
import { infiniteQueryOptions, keepPreviousData, queryOptions } from "@tanstack/react-query";
import { chatApi } from "../chat-api";
import {
  CHAT_HISTORY_PAGE_SIZE,
  compareMessages,
  flattenRoomTimeline,
  olderRoomPageParam,
  type RoomMessagesPageParam,
} from "../chat-timeline";
import { chatKeys } from "./chat-keys";

export const roomsOptions = (wsId: string) =>
  queryOptions({
    queryKey: chatKeys.rooms(wsId),
    queryFn: ({ signal }) => chatApi.listRooms(wsId, signal),
    // A reconnect after a server restart must not keep a briefly empty list.
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
    getNextPageParam: (lastPage, allPages, lastPageParam) =>
      olderRoomPageParam(lastPage, allPages, lastPageParam, CHAT_HISTORY_PAGE_SIZE),
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
    queryFn: ({ pageParam }) =>
      chatApi.listThreadMessages(wsId, roomId, rootId, { ...(pageParam ?? {}), limit: CHAT_HISTORY_PAGE_SIZE }),
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

/** M3: the follow-ups a message's sheet looks itself up in (the web's follow-ups sheet lists the same). */
export const followUpsOptions = (wsId: string) =>
  queryOptions({ queryKey: chatKeys.followUps(wsId), queryFn: () => chatApi.listFollowUps(wsId, true), staleTime: 30_000 });

/** M3: which of the messages on screen carry a task, one request per window (chat-message-links-context). */
export const roomLinksOptions = (wsId: string, roomId: string, messageIds: readonly string[]) =>
  queryOptions({
    queryKey: chatKeys.roomLinks(wsId, roomId, messageIds),
    queryFn: () => chatApi.listRoomMessageLinks(wsId, roomId, [...messageIds]),
    enabled: messageIds.length > 0,
    staleTime: 30_000,
    // A new message changes the key; the cards stay while the next answer comes.
    placeholderData: keepPreviousData,
  });

export const taskOptions = (wsId: string, taskId: string) =>
  queryOptions({ queryKey: chatKeys.task(wsId, taskId), queryFn: () => chatApi.getTask(taskId), staleTime: 60_000 });

/** Stickers or GIFs for the picker: trending, or a search once the query has text. */
export const expressionsOptions = (wsId: string, kind: "stickers" | "gifs", q: string) =>
  queryOptions({ queryKey: chatKeys.expressions(wsId, kind, q.trim()), queryFn: () => chatApi.listExpressions(wsId, kind, q), staleTime: 5 * 60_000 });

export const workspaceMembersOptions = (wsId: string) =>
  queryOptions({ queryKey: chatKeys.members(wsId), queryFn: () => chatApi.listWorkspaceMembers(wsId), staleTime: 5 * 60_000 });

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

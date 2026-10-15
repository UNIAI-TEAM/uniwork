"use client";
import { type QueryClient, useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as chat from "../api/endpoints/chat";
import type { ChatMessageRecord } from "../api/endpoints/chat";
import { useAuthStore } from "../auth/store";
import { notificationKeys } from "../notifications/hooks";
import { chatKeys } from "./chat-keys";
import { usePendingChatMessagesStore } from "./pending-messages-store";
import { applyChatMessageResponse } from "./realtime-cache";
import {
  CHAT_HISTORY_PAGE_SIZE,
  compareMessages,
  flattenRoomTimeline,
  olderRoomPageParam,
  type RoomMessagesPageParam,
  type RoomTimeline,
} from "./room-timeline";

/** Oldest first: the root sits on the newest page but is older than every reply. */
function flattenThread(data: RoomTimeline): ChatMessageRecord[] {
  return flattenRoomTimeline(data).sort(compareMessages);
}

/**
 * A thread as a `RoomTimeline`: the first page is the root then the newest
 * replies, each older page chains from the oldest reply's cursor (UNI-1679).
 */
export function useChatThreadMessages(
  workspaceId: string,
  roomId: string,
  threadRootId: string,
  enabled = true,
  limit = 50,
) {
  const authReady = useAuthStore((s) => s.status === "authed");
  return useInfiniteQuery({
    queryKey: chatKeys.threadMessages(workspaceId, roomId, threadRootId),
    queryFn: ({ pageParam }: { pageParam: RoomMessagesPageParam }) =>
      chat.listChatThreadMessages(
        workspaceId,
        roomId,
        threadRootId,
        pageParam === null ? { limit } : { ...pageParam, limit: CHAT_HISTORY_PAGE_SIZE },
      ),
    initialPageParam: null as RoomMessagesPageParam,
    // The root heads the first page and is older than every reply: page from the replies only.
    getNextPageParam: (lastPage, allPages, lastPageParam) =>
      olderRoomPageParam(
        lastPage.filter((m) => m.thread_root_id),
        allPages,
        lastPageParam,
        limit,
      ),
    select: flattenThread,
    enabled: !!workspaceId && !!roomId && !!threadRootId && authReady && enabled,
  });
}

export function useSendChatThreadMessage(workspaceId: string, roomId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      threadRootId: string;
      body: string;
      client_msg_id?: string;
      priority?: string;
    }) =>
      chat.sendChatThreadMessage(workspaceId, roomId, input.threadRootId, {
        body: input.body,
        client_msg_id: input.client_msg_id,
        priority: input.priority,
      }),
    onSuccess: (data, vars) => {
      if (vars.client_msg_id) {
        usePendingChatMessagesStore.getState().remove(vars.client_msg_id);
      }
      void qc.invalidateQueries({
        queryKey: chatKeys.threadMessages(workspaceId, roomId, vars.threadRootId),
      });
      applyChatMessageResponse(qc, workspaceId, roomId, data, true);
      void qc.invalidateQueries({ queryKey: chatKeys.followedThreads(workspaceId) });
    },
  });
}

export function useFollowedChatThreads(
  workspaceId: string,
  unreadOnly = false,
  enabled = true,
) {
  const authReady = useAuthStore((s) => s.status === "authed");
  return useQuery({
    queryKey: chatKeys.followedThreads(workspaceId, unreadOnly),
    queryFn: () => chat.listFollowedChatThreads(workspaceId, { unread: unreadOnly }),
    enabled: !!workspaceId && authReady && enabled,
  });
}

// The thread bar reads its Follow state from the root in the thread listing.
function invalidateThreadFollowState(qc: QueryClient, workspaceId: string, threadRootId: string) {
  void qc.invalidateQueries({ queryKey: chatKeys.followedThreads(workspaceId) });
  void qc.invalidateQueries({
    queryKey: chatKeys.threadMessagesRoot(workspaceId),
    predicate: (q) => q.queryKey.includes(threadRootId),
  });
}

export function useFollowChatThread(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (threadRootId: string) => chat.followChatThread(workspaceId, threadRootId),
    onSuccess: (_d, threadRootId) => invalidateThreadFollowState(qc, workspaceId, threadRootId),
  });
}

export function useUnfollowChatThread(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (threadRootId: string) => chat.unfollowChatThread(workspaceId, threadRootId),
    onSuccess: (_d, threadRootId) => invalidateThreadFollowState(qc, workspaceId, threadRootId),
  });
}

export function useMarkChatThreadRead(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (threadRootId: string) => chat.markChatThreadRead(workspaceId, threadRootId),
    onSuccess: (_d, threadRootId) => {
      void qc.invalidateQueries({ queryKey: chatKeys.followedThreads(workspaceId) });
      void qc.invalidateQueries({
        queryKey: ["chat", "thread-messages", workspaceId],
        predicate: (q) => q.queryKey.includes(threadRootId),
      });
      // The read also closed the thread's inbox row server-side (UNI-1665).
      void qc.invalidateQueries({ queryKey: notificationKeys.unreadCount() });
      void qc.invalidateQueries({ queryKey: notificationKeys.lists() });
    },
  });
}

"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as chat from "../api/endpoints/chat";
import { useAuthStore } from "../auth/store";
import { chatKeys } from "./chat-keys";
import { usePendingChatMessagesStore } from "./pending-messages-store";

export function useChatThreadMessages(
  workspaceId: string,
  roomId: string,
  threadRootId: string,
  enabled = true,
) {
  const authReady = useAuthStore((s) => s.status === "authed");
  return useQuery({
    queryKey: chatKeys.threadMessages(workspaceId, roomId, threadRootId),
    queryFn: () => chat.listChatThreadMessages(workspaceId, roomId, threadRootId),
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
    onSuccess: (_data, vars) => {
      if (vars.client_msg_id) {
        usePendingChatMessagesStore.getState().remove(vars.client_msg_id);
      }
      void qc.invalidateQueries({
        queryKey: chatKeys.threadMessages(workspaceId, roomId, vars.threadRootId),
      });
      void qc.invalidateQueries({ queryKey: chatKeys.roomMessages(workspaceId, roomId) });
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

export function useFollowChatThread(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (threadRootId: string) => chat.followChatThread(workspaceId, threadRootId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: chatKeys.followedThreads(workspaceId) });
    },
  });
}

export function useUnfollowChatThread(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (threadRootId: string) => chat.unfollowChatThread(workspaceId, threadRootId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: chatKeys.followedThreads(workspaceId) });
    },
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
    },
  });
}

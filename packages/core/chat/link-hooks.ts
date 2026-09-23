"use client";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as chat from "../api/endpoints/chat";
import type {
  CreateChatMessageLinkInput,
  CreateTaskFromMessageInput,
  SyncThreadTaskInput,
} from "../api/endpoints/chat-links";
import { useAuthStore } from "../auth/store";
import { taskKeys } from "../tasks/keys";
import { chatKeys } from "./chat-keys";
import { groupLinksByMessageId } from "./message-links";
import { invalidateChatMessageLinks } from "./realtime-cache";

function invalidateMessageLinks(
  qc: ReturnType<typeof useQueryClient>,
  workspaceId: string,
  messageId: string,
) {
  invalidateChatMessageLinks(qc, workspaceId, messageId);
}

/** The server caps one batch; a longer timeline asks in slices of this size. */
const ROOM_LINKS_BATCH = 200;

/**
 * Links for every message a room timeline shows, in one request per batch
 * rather than one per message. Keyed by the sorted id list, so a new message
 * asks again while the previous answer stays on screen.
 */
export function useChatRoomMessageLinks(
  workspaceId: string,
  roomId: string,
  messageIds: readonly string[],
  enabled = true,
) {
  const authReady = useAuthStore((s) => s.status === "authed");
  const idsKey = [...new Set(messageIds)].sort().join(",");
  return useQuery({
    queryKey: chatKeys.roomMessageLinks(workspaceId, roomId, idsKey),
    queryFn: async () => {
      const ids = idsKey ? idsKey.split(",") : [];
      const batches: string[][] = [];
      for (let i = 0; i < ids.length; i += ROOM_LINKS_BATCH) {
        batches.push(ids.slice(i, i + ROOM_LINKS_BATCH));
      }
      const results = await Promise.all(
        batches.map((batch) => chat.listChatRoomMessageLinks(workspaceId, roomId, batch)),
      );
      return groupLinksByMessageId(results.flat());
    },
    enabled: !!workspaceId && !!roomId && idsKey.length > 0 && authReady && enabled,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}

export function useCreateTaskFromChatMessage(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { messageId: string } & CreateTaskFromMessageInput) => {
      const { messageId, ...body } = input;
      return chat.createTaskFromChatMessage(workspaceId, messageId, body);
    },
    onSuccess: (_task, vars) => {
      invalidateMessageLinks(qc, workspaceId, vars.messageId);
      void qc.invalidateQueries({ queryKey: taskKeys.list(workspaceId) });
      void qc.invalidateQueries({ queryKey: taskKeys.queryRoot(workspaceId) });
      void qc.invalidateQueries({ queryKey: taskKeys.myTasks(workspaceId) });
    },
  });
}

export function useLinkChatMessage(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { messageId: string } & CreateChatMessageLinkInput) => {
      const { messageId, ...body } = input;
      return chat.createChatMessageLink(workspaceId, messageId, body);
    },
    onSuccess: (_link, vars) => {
      invalidateMessageLinks(qc, workspaceId, vars.messageId);
    },
  });
}

export function useUnlinkChatMessage(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { messageId: string; linkId: string }) =>
      chat.deleteChatMessageLink(workspaceId, input.messageId, input.linkId),
    onSuccess: (_ok, vars) => {
      invalidateMessageLinks(qc, workspaceId, vars.messageId);
    },
  });
}

export function useSyncChatThreadTask(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { threadRootId: string } & SyncThreadTaskInput) => {
      const { threadRootId, ...body } = input;
      return chat.syncChatThreadTask(workspaceId, threadRootId, body);
    },
    onSuccess: (_ok, vars) => {
      invalidateMessageLinks(qc, workspaceId, vars.threadRootId);
    },
  });
}

export function useUnsyncChatThreadTask(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (threadRootId: string) => chat.unsyncChatThreadTask(workspaceId, threadRootId),
    onSuccess: (_ok, threadRootId) => {
      invalidateMessageLinks(qc, workspaceId, threadRootId);
    },
  });
}

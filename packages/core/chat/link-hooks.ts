"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as chat from "../api/endpoints/chat";
import type {
  CreateChatMessageLinkInput,
  CreateTaskFromMessageInput,
  SyncThreadTaskInput,
} from "../api/endpoints/chat-links";
import { useAuthStore } from "../auth/store";
import { taskKeys } from "../tasks/keys";
import { chatKeys } from "./chat-keys";

function invalidateMessageLinks(
  qc: ReturnType<typeof useQueryClient>,
  workspaceId: string,
  messageId: string,
) {
  void qc.invalidateQueries({ queryKey: chatKeys.messageLinks(workspaceId, messageId) });
}

export function useChatMessageLinks(
  workspaceId: string,
  messageId: string,
  enabled = true,
) {
  const authReady = useAuthStore((s) => s.status === "authed");
  return useQuery({
    queryKey: chatKeys.messageLinks(workspaceId, messageId),
    queryFn: () => chat.listChatMessageLinks(workspaceId, messageId),
    enabled: !!workspaceId && !!messageId && authReady && enabled,
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

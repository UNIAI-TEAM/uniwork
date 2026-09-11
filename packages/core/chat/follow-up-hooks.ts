"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as chat from "../api/endpoints/chat";
import type {
  CreateChatFollowUpInput,
  ListChatFollowUpsParams,
  PatchChatFollowUpInput,
} from "../api/endpoints/chat-follow-ups";
import type { CreateTaskFromMessageInput } from "../api/endpoints/chat-links";
import { useAuthStore } from "../auth/store";
import { taskKeys } from "../tasks/keys";
import { chatKeys } from "./chat-keys";

function invalidateFollowUps(qc: ReturnType<typeof useQueryClient>, workspaceId: string) {
  void qc.invalidateQueries({ queryKey: chatKeys.followUps(workspaceId) });
}

export function useChatFollowUps(
  workspaceId: string,
  params: ListChatFollowUpsParams = {},
  enabled = true,
) {
  const authReady = useAuthStore((s) => s.status === "authed");
  const includeCompleted = params.include_completed === true;
  const limit = params.limit ?? 0;
  return useQuery({
    // Params after the root so invalidateQueries(chatKeys.followUps(wsId)) matches all.
    queryKey: [...chatKeys.followUps(workspaceId), includeCompleted, limit] as const,
    queryFn: () => chat.listChatFollowUps(workspaceId, params),
    enabled: !!workspaceId && authReady && enabled,
  });
}

export function useCreateChatFollowUp(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { messageId: string } & CreateChatFollowUpInput) => {
      const { messageId, ...body } = input;
      return chat.createChatFollowUp(workspaceId, messageId, body);
    },
    onSuccess: () => {
      invalidateFollowUps(qc, workspaceId);
    },
  });
}

export function usePatchChatFollowUp(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { followUpId: string } & PatchChatFollowUpInput) => {
      const { followUpId, ...body } = input;
      return chat.patchChatFollowUp(workspaceId, followUpId, body);
    },
    onSuccess: () => {
      invalidateFollowUps(qc, workspaceId);
    },
  });
}

export function useDeleteChatFollowUp(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (followUpId: string) => chat.deleteChatFollowUp(workspaceId, followUpId),
    onSuccess: () => {
      invalidateFollowUps(qc, workspaceId);
    },
  });
}

export function useConvertChatFollowUpToTask(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { followUpId: string } & CreateTaskFromMessageInput) => {
      const { followUpId, ...body } = input;
      return chat.convertChatFollowUpToTask(workspaceId, followUpId, body);
    },
    onSuccess: () => {
      invalidateFollowUps(qc, workspaceId);
      void qc.invalidateQueries({ queryKey: taskKeys.list(workspaceId) });
      void qc.invalidateQueries({ queryKey: taskKeys.queryRoot(workspaceId) });
      void qc.invalidateQueries({ queryKey: taskKeys.myTasks(workspaceId) });
    },
  });
}

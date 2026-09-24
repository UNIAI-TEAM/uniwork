"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as chat from "../api/endpoints/chat";
import type {
  CreateChatChannelInput,
  ListChatChannelsOpts,
  UpdateChatChannelInput,
} from "../api/endpoints/chat-channels";
import { useAuthStore } from "../auth/store";
import { chatKeys } from "./chat-keys";

function invalidateChannelLists(qc: ReturnType<typeof useQueryClient>, workspaceId: string) {
  void qc.invalidateQueries({ queryKey: chatKeys.rooms(workspaceId) });
  void qc.invalidateQueries({ queryKey: ["chat", "channels", workspaceId] });
  void qc.invalidateQueries({ queryKey: ["chat", "project-channels", workspaceId] });
}

export function useChatChannels(
  workspaceId: string,
  opts: ListChatChannelsOpts = {},
  enabled = true,
) {
  const authReady = useAuthStore((s) => s.status === "authed");
  const scope = opts.scope ?? "mine";
  const projectId = opts.project_id ?? "";
  const q = opts.q ?? "";
  return useQuery({
    queryKey: chatKeys.channels(workspaceId, scope, projectId, q),
    queryFn: () => chat.listChatChannels(workspaceId, { ...opts, scope }),
    enabled: !!workspaceId && authReady && enabled,
  });
}

export function useProjectChatChannels(
  workspaceId: string,
  projectId: string,
  enabled = true,
) {
  const authReady = useAuthStore((s) => s.status === "authed");
  return useQuery({
    queryKey: chatKeys.projectChannels(workspaceId, projectId),
    queryFn: () => chat.listProjectChatChannels(workspaceId, projectId),
    enabled: !!workspaceId && !!projectId && authReady && enabled,
  });
}

export function useCreateChatChannel(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateChatChannelInput) => chat.createChatChannel(workspaceId, input),
    onSuccess: () => {
      invalidateChannelLists(qc, workspaceId);
    },
  });
}

export function useUpdateChatChannel(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { roomId: string } & UpdateChatChannelInput) => {
      const { roomId, ...body } = input;
      return chat.updateChatChannel(workspaceId, roomId, body);
    },
    onSuccess: () => {
      invalidateChannelLists(qc, workspaceId);
    },
  });
}

export function useJoinChatChannel(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (roomId: string) => chat.joinChatChannel(workspaceId, roomId),
    onSuccess: () => {
      invalidateChannelLists(qc, workspaceId);
    },
  });
}

export function useArchiveChatChannel(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (roomId: string) => chat.archiveChatChannel(workspaceId, roomId),
    onSuccess: (_data, roomId) => {
      invalidateChannelLists(qc, workspaceId);
      void qc.removeQueries({ queryKey: chatKeys.roomMessages(workspaceId, roomId) });
    },
  });
}

export function useUnarchiveChatChannel(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (roomId: string) => chat.unarchiveChatChannel(workspaceId, roomId),
    onSuccess: () => {
      invalidateChannelLists(qc, workspaceId);
    },
  });
}

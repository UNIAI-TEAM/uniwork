"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as chat from "../api/endpoints/chat";
import { listChatRoomMessages } from "../api/endpoints/chat";
import { workspaceKeys } from "../workspaces/hooks";
import { useAuthStore } from "../auth/store";
import { chatKeys } from "./chat-keys";

export function useWorkspaceChatRoom(workspaceId: string) {
  const authReady = useAuthStore((s) => s.status === "authed");
  return useQuery({
    queryKey: chatKeys.room(workspaceId),
    queryFn: () => chat.getWorkspaceChatRoom(workspaceId),
    enabled: !!workspaceId && authReady,
    retry: 2,
    retryDelay: 400,
  });
}

export function useEnsureWorkspaceChatRoom(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const room = await chat.ensureWorkspaceChatRoom(workspaceId);
      if (!room?.room_id) throw new Error("chat_room_failed");
      return room;
    },
    onSuccess: (room) => {
      qc.setQueryData(chatKeys.room(workspaceId), room);
    },
  });
}

export function useWorkspaceChatMessages(workspaceId: string, enabled: boolean) {
  const authReady = useAuthStore((s) => s.status === "authed");
  return useQuery({
    queryKey: chatKeys.messages(workspaceId),
    queryFn: () => chat.listWorkspaceChatMessages(workspaceId),
    enabled: !!workspaceId && authReady && enabled,
    refetchInterval: false,
  });
}

export function useSendWorkspaceChatMessage(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { body: string; reply_to_message_id?: string }) =>
      chat.sendWorkspaceChatMessage(workspaceId, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: chatKeys.messages(workspaceId) });
      void qc.invalidateQueries({ queryKey: chatKeys.room(workspaceId) });
      void qc.invalidateQueries({ queryKey: chatKeys.rooms(workspaceId) });
    },
  });
}

export function useChatRooms(workspaceId: string) {
  const authReady = useAuthStore((s) => s.status === "authed");
  return useQuery({
    queryKey: chatKeys.rooms(workspaceId),
    queryFn: () => chat.listChatRooms(workspaceId),
    enabled: !!workspaceId && authReady,
  });
}

export function useResolveDMRoom(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => chat.resolveDMRoom(workspaceId, userId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: chatKeys.rooms(workspaceId) });
    },
  });
}

export function useCreateChatGroup(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; member_user_ids: string[] }) =>
      chat.createChatGroup(workspaceId, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: chatKeys.rooms(workspaceId) });
    },
  });
}

export function useInviteChatGroupMembers(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { roomId: string; memberUserIds: string[] }) =>
      chat.inviteChatGroupMembers(workspaceId, input.roomId, input.memberUserIds),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: chatKeys.rooms(workspaceId) });
    },
  });
}

export function useLeaveChatRoom(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (roomId: string) => chat.leaveChatRoom(workspaceId, roomId),
    onSuccess: (_data, roomId) => {
      void qc.invalidateQueries({ queryKey: chatKeys.rooms(workspaceId) });
      void qc.removeQueries({ queryKey: chatKeys.roomMessages(workspaceId, roomId) });
    },
  });
}

export function useRemoveWorkspaceChatRoomMember(workspaceId: string) {
  return useRemoveChatRoomMember(workspaceId);
}

export function useRemoveChatRoomMember(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { roomId: string; userId: string }) =>
      chat.removeChatRoomMember(workspaceId, input.roomId, input.userId),
    onSuccess: (_data, variables) => {
      void qc.invalidateQueries({ queryKey: chatKeys.rooms(workspaceId) });
      void qc.invalidateQueries({ queryKey: chatKeys.roomMembers(workspaceId, variables.roomId) });
      void qc.invalidateQueries({ queryKey: workspaceKeys.members(workspaceId) });
      void qc.invalidateQueries({ queryKey: workspaceKeys.me(workspaceId) });
    },
  });
}

export function useChatRoomMembers(workspaceId: string, roomId: string, enabled = true) {
  return useQuery({
    queryKey: chatKeys.roomMembers(workspaceId, roomId),
    queryFn: () => chat.listChatRoomMembers(workspaceId, roomId),
    enabled: enabled && Boolean(roomId),
  });
}

export function useUpdateChatRoomMember(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      roomId: string;
      userId: string;
      role?: "admin" | "member";
      send_restricted?: boolean;
    }) =>
      chat.patchChatRoomMember(workspaceId, input.roomId, input.userId, {
        role: input.role,
        send_restricted: input.send_restricted,
      }),
    onSuccess: (_data, variables) => {
      void qc.invalidateQueries({ queryKey: chatKeys.roomMembers(workspaceId, variables.roomId) });
      void qc.invalidateQueries({ queryKey: chatKeys.rooms(workspaceId) });
    },
  });
}

export function useUpdateChatRoomSettings(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      roomId: string;
      name?: string;
      member_permissions?: Partial<chat.ChatRoomMemberPermissions>;
    }) =>
      chat.patchChatRoom(workspaceId, input.roomId, {
        name: input.name,
        member_permissions: input.member_permissions,
      }),
    onSuccess: (_data, variables) => {
      void qc.invalidateQueries({ queryKey: chatKeys.rooms(workspaceId) });
      void qc.invalidateQueries({ queryKey: chatKeys.roomMessages(workspaceId, variables.roomId) });
    },
  });
}

export function useChatRoomMessages(workspaceId: string, roomId: string | null, limit = 50) {
  const authReady = useAuthStore((s) => s.status === "authed");
  return useQuery({
    queryKey: chatKeys.roomMessages(workspaceId, roomId ?? ""),
    queryFn: () => listChatRoomMessages(workspaceId, roomId!, { limit }),
    enabled: !!workspaceId && !!roomId && authReady,
    staleTime: 5_000,
  });
}

export function useSearchChatRoomMessages(
  workspaceId: string,
  roomId: string | null,
  query: string,
  enabled: boolean,
) {
  const authReady = useAuthStore((s) => s.status === "authed");
  const normalized = query.trim();
  return useQuery({
    queryKey: chatKeys.roomMessageSearch(workspaceId, roomId ?? "", normalized),
    queryFn: () => chat.searchChatRoomMessages(workspaceId, roomId!, { q: normalized, limit: 30 }),
    enabled:
      !!workspaceId && !!roomId && authReady && enabled && normalized.length >= 2,
    staleTime: 30_000,
  });
}

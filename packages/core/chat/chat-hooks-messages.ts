"use client";
import { useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as chat from "../api/endpoints/chat";
import type { ChatRoomRecord, ChatUserLookup } from "../api/endpoints/chat";
import { ApiError } from "../api/http";
import { runWithChatSendRetry } from "./send-retry";
import { usePendingChatMessagesStore } from "./pending-messages-store";
import { lookupChatUserCached } from "./user-lookup";
import { useAuthStore } from "../auth/store";
import { chatKeys } from "./chat-keys";
import {
  applyChatMessageResponse,
  insertCreatedRoomMessage,
  patchChatMessageDeleted,
  patchRoomSidebarFromMessage,
} from "./realtime-cache";

export function useSendChatRoomMessage(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      roomId: string;
      body?: string;
      client_msg_id?: string;
      reply_to_message_id?: string;
      poll?: {
        question: string;
        options: string[];
        settings?: {
          deadline_at?: string | null;
          pin_to_top?: boolean;
          allow_multiple?: boolean;
          allow_add_options?: boolean;
          hide_results_until_vote?: boolean;
          hide_voters?: boolean;
        };
      };
      reminder?: {
        body: string;
        remind_at: string;
        repeat?: string;
      };
      note?: {
        body: string;
        pin_to_top?: boolean;
      };
      post?: {
        title: string;
        body: string;
        pin_to_top?: boolean;
      };
      priority?: "important" | "urgent";
    }) => runWithChatSendRetry(() => chat.sendChatRoomMessage(workspaceId, input.roomId, input)),
    onSuccess: (data, variables) => {
      if (variables.client_msg_id) {
        usePendingChatMessagesStore.getState().remove(variables.client_msg_id);
      }
      if (data) {
        insertCreatedRoomMessage(qc, workspaceId, variables.roomId, data);
        qc.setQueryData<ChatRoomRecord[]>(chatKeys.rooms(workspaceId), (old) =>
          patchRoomSidebarFromMessage(old, variables.roomId, data),
        );
      } else {
        void qc.invalidateQueries({
          queryKey: chatKeys.roomMessages(workspaceId, variables.roomId),
        });
        void qc.invalidateQueries({ queryKey: chatKeys.rooms(workspaceId) });
      }
      void qc.invalidateQueries({ queryKey: chatKeys.messages(workspaceId) });
    },
  });
}

export function useSendChatVoiceMessage(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      roomId: string;
      file: Blob;
      duration_ms: number;
      client_msg_id: string;
      reply_to_message_id?: string;
    }) => chat.sendChatVoiceMessage(workspaceId, input.roomId, input),
    onSuccess: (data, variables) => {
      applyChatMessageResponse(qc, workspaceId, variables.roomId, data, true);
      void qc.invalidateQueries({ queryKey: chatKeys.messages(workspaceId) });
      void qc.invalidateQueries({ queryKey: chatKeys.rooms(workspaceId) });
    },
  });
}

export function useSendChatFileMessage(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      roomId: string;
      file: Blob;
      filename: string;
      client_msg_id: string;
      reply_to_message_id?: string;
    }) => chat.sendChatFileMessage(workspaceId, input.roomId, input),
    onSuccess: (data, variables) => {
      applyChatMessageResponse(qc, workspaceId, variables.roomId, data, true);
      void qc.invalidateQueries({ queryKey: chatKeys.messages(workspaceId) });
      void qc.invalidateQueries({ queryKey: chatKeys.rooms(workspaceId) });
    },
  });
}

export function useVoteChatPollMessage(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { roomId: string; messageId: string; optionId: string }) =>
      chat.voteChatPollMessage(workspaceId, input.roomId, input.messageId, input.optionId),
    onSuccess: (data, variables) => {
      applyChatMessageResponse(qc, workspaceId, variables.roomId, data, false);
    },
  });
}

export function useToggleChatReaction(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { roomId: string; messageId: string; emoji: string }) =>
      chat.toggleChatMessageReaction(workspaceId, input.roomId, input.messageId, input.emoji),
    onSuccess: (data, variables) => {
      applyChatMessageResponse(qc, workspaceId, variables.roomId, data, false);
    },
  });
}

export function useEditChatMessage(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { roomId: string; messageId: string; body: string }) =>
      chat.editChatRoomMessage(workspaceId, input.roomId, input.messageId, input.body),
    onSuccess: (data, variables) => {
      applyChatMessageResponse(qc, workspaceId, variables.roomId, data, false);
      void qc.invalidateQueries({ queryKey: chatKeys.messages(workspaceId) });
    },
  });
}

export function useDeleteChatMessage(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { roomId: string; messageId: string }) =>
      chat.deleteChatRoomMessage(workspaceId, input.roomId, input.messageId),
    onSuccess: (_data, variables) => {
      patchChatMessageDeleted(qc, workspaceId, variables.roomId, variables.messageId);
      void qc.invalidateQueries({ queryKey: chatKeys.messages(workspaceId) });
      void qc.invalidateQueries({ queryKey: chatKeys.rooms(workspaceId) });
    },
  });
}

export function useToggleChatMessagePin(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { roomId: string; messageId: string }) =>
      chat.toggleChatMessagePin(workspaceId, input.roomId, input.messageId),
    onSuccess: (data, variables) => {
      applyChatMessageResponse(qc, workspaceId, variables.roomId, data, false);
    },
  });
}

/** A signed URL counts as dead this long before it ends, so a click never lands on one. */
const CHAT_MEDIA_URL_MARGIN_MS = 60_000;

/**
 * Whether a file or voice message's signed storage URL (UNI-1633) can still
 * be used. The message list carries the URLs; a screen left open past
 * url_expires_at holds dead ones.
 */
export function isChatMediaUrlFresh(
  url: string | undefined,
  expiresAt: string | undefined,
  now: number = Date.now(),
): boolean {
  if (!url) return false;
  const at = Date.parse(expiresAt ?? "");
  return Number.isFinite(at) && at - CHAT_MEDIA_URL_MARGIN_MS > now;
}

/**
 * Loads one message again for freshly signed media URLs and writes it back
 * into the room caches, so every row showing it re-renders with them.
 */
export function useRefreshChatMessageMedia(workspaceId: string, roomId: string) {
  const qc = useQueryClient();
  // Stable across renders: callers key effects on it.
  return useCallback(
    async (messageId: string): Promise<chat.ChatMessageRecord | null> => {
      const fresh = await chat.getChatRoomMessage(workspaceId, roomId, messageId);
      applyChatMessageResponse(qc, workspaceId, roomId, fresh, false);
      return fresh;
    },
    [qc, workspaceId, roomId],
  );
}

/** Shared-media counts and newest photos of one room, without paging its history. */
export function useChatRoomSharedSummary(workspaceId: string, roomId: string, enabled = true) {
  const authReady = useAuthStore((s) => s.status === "authed");
  return useQuery({
    queryKey: chatKeys.roomSharedSummary(workspaceId, roomId),
    queryFn: () => chat.getChatRoomSharedSummary(workspaceId, roomId),
    enabled: authReady && enabled && !!workspaceId && !!roomId,
  });
}

export function useChatBlockStatus(workspaceId: string, userId: string, enabled: boolean) {
  const authReady = useAuthStore((s) => s.status === "authed");
  return useQuery({
    queryKey: chatKeys.block(workspaceId, userId),
    queryFn: () => chat.getChatBlockStatus(workspaceId, userId),
    enabled: !!workspaceId && !!userId && authReady && enabled,
    staleTime: 0,
  });
}

export function useBlockChatUser(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => chat.blockChatUser(workspaceId, userId),
    onSuccess: (_data, userId) => {
      void qc.invalidateQueries({ queryKey: chatKeys.rooms(workspaceId) });
      void qc.invalidateQueries({ queryKey: chatKeys.block(workspaceId, userId) });
    },
  });
}

export function useUnblockChatUser(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => chat.unblockChatUser(workspaceId, userId),
    onSuccess: (_data, userId) => {
      void qc.invalidateQueries({ queryKey: chatKeys.block(workspaceId, userId) });
      void qc.invalidateQueries({ queryKey: chatKeys.rooms(workspaceId) });
    },
  });
}

export function useChatNicknames(workspaceId: string) {
  const authReady = useAuthStore((s) => s.status === "authed");
  return useQuery({
    queryKey: chatKeys.nicknames(workspaceId),
    queryFn: () => chat.listChatNicknames(workspaceId),
    enabled: !!workspaceId && authReady,
    staleTime: 30_000,
  });
}

export function useSetChatNickname(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, nickname }: { userId: string; nickname: string }) =>
      chat.setChatNickname(workspaceId, userId, nickname),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: chatKeys.nicknames(workspaceId) });
    },
  });
}

export function useChatGifs(workspaceId: string, query: string, enabled = true) {
  const authReady = useAuthStore((s) => s.status === "authed");
  const trimmed = query.trim();
  return useQuery({
    queryKey: chatKeys.gifs(workspaceId, trimmed),
    queryFn: () =>
      trimmed ? chat.searchChatGifs(workspaceId, trimmed) : chat.listTrendingChatGifs(workspaceId),
    enabled: !!workspaceId && authReady && enabled,
    staleTime: 60_000,
  });
}

export function useChatStickers(workspaceId: string, query: string, enabled = true) {
  const authReady = useAuthStore((s) => s.status === "authed");
  const trimmed = query.trim();
  return useQuery({
    queryKey: chatKeys.stickers(workspaceId, trimmed),
    queryFn: () =>
      trimmed
        ? chat.searchChatStickers(workspaceId, trimmed)
        : chat.listTrendingChatStickers(workspaceId),
    enabled: !!workspaceId && authReady && enabled,
    staleTime: 60_000,
  });
}

export function useChatMediaStatus(workspaceId: string, enabled = true) {
  const authReady = useAuthStore((s) => s.status === "authed");
  return useQuery({
    queryKey: chatKeys.mediaStatus(workspaceId),
    queryFn: () => chat.getChatMediaStatus(workspaceId),
    enabled: !!workspaceId && authReady && enabled,
    staleTime: 300_000,
  });
}

export function useLookupChatUser(workspaceId: string, email: string, enabled: boolean) {
  const normalized = email.trim().toLowerCase();
  return useQuery({
    queryKey: chatKeys.lookup(workspaceId, normalized),
    queryFn: async (): Promise<ChatUserLookup | null> => {
      try {
        return await lookupChatUserCached(workspaceId, normalized);
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) return null;
        throw err;
      }
    },
    enabled: !!workspaceId && enabled && normalized.includes("@") && normalized.length >= 5,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
}

export function useChatVoiceToken() {
  return useMutation({
    mutationFn: ({ roomId, callId }: { roomId: string; callId: string }) =>
      chat.mintChatVoiceToken(roomId, callId),
  });
}

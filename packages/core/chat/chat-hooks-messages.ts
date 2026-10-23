"use client";
import { useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as chat from "../api/endpoints/chat";
import type { ChatDocumentShareLevel, ChatRoomRecord, ChatUserLookup } from "../api/endpoints/chat";
import { ApiError } from "../api/http";
import { runWithChatSendRetry } from "./send-retry";
import { lookupChatUserCached } from "./user-lookup";
import { useAuthStore } from "../auth/store";
import { documentKeys } from "../documents/keys";
import { patchRoomSidebarFromMessage } from "./chat-cache-records";
import { chatKeys } from "./chat-keys";
import {
  buildOptimisticRoomMessageRecord,
  commitOptimisticRoomSend,
  insertOptimisticRoomMessageIfLoaded,
  removeOptimisticRoomMessage,
} from "./optimistic-outbound-message";
import { usePendingChatMessagesStore } from "./pending-messages-store";
import {
  applyChatMessageResponse,
  insertCreatedRoomMessage,
  invalidateRoomSharedSummary,
  patchChatMessageDeleted,
} from "./realtime-cache";

type RoomSendVariables = {
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
};

export function useSendChatRoomMessage(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: RoomSendVariables) =>
      runWithChatSendRetry(() => chat.sendChatRoomMessage(workspaceId, input.roomId, input)),
    onMutate: async (variables) => {
      const user = useAuthStore.getState().user;
      if (!user || !variables.client_msg_id || !variables.body) {
        return { usedPendingFallback: false as const };
      }
      const optimistic = buildOptimisticRoomMessageRecord(workspaceId, variables, {
        id: user.id,
        display_name: user.display_name,
      });
      if (!optimistic) return { usedPendingFallback: false as const };
      const inserted = insertOptimisticRoomMessageIfLoaded(qc, workspaceId, variables.roomId, optimistic);
      if (!inserted) {
        usePendingChatMessagesStore.getState().upsert({
          workspaceId,
          roomId: variables.roomId,
          client_msg_id: variables.client_msg_id,
          body: variables.body,
          senderId: user.id,
          createdAt: Date.now(),
          reply_to_message_id: variables.reply_to_message_id,
          priority: variables.priority,
          status: "sending",
        });
      }
      return { usedPendingFallback: !inserted, client_msg_id: variables.client_msg_id };
    },
    onError: (_err, variables) => {
      if (!variables.client_msg_id) return;
      removeOptimisticRoomMessage(qc, workspaceId, variables.roomId, variables.client_msg_id);
      usePendingChatMessagesStore.getState().remove(variables.client_msg_id);
    },
    onSuccess: (data, variables) => {
      if (variables.client_msg_id) {
        usePendingChatMessagesStore.getState().remove(variables.client_msg_id);
      }
      if (data) {
        const timelineLoaded =
          qc.getQueryData(chatKeys.roomMessages(workspaceId, variables.roomId)) !== undefined;
        if (variables.client_msg_id && timelineLoaded) {
          commitOptimisticRoomSend(qc, workspaceId, variables.roomId, variables.client_msg_id, data);
          invalidateRoomSharedSummary(qc, workspaceId, variables.roomId);
        } else {
          insertCreatedRoomMessage(qc, workspaceId, variables.roomId, data);
        }
        qc.setQueryData<ChatRoomRecord[]>(chatKeys.rooms(workspaceId), (old) =>
          patchRoomSidebarFromMessage(old, variables.roomId, data),
        );
      } else {
        void qc.invalidateQueries({
          queryKey: chatKeys.roomMessages(workspaceId, variables.roomId),
        });
        void qc.invalidateQueries({ queryKey: chatKeys.rooms(workspaceId) });
      }
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
      void qc.invalidateQueries({ queryKey: chatKeys.rooms(workspaceId) });
    },
  });
}

/**
 * UNI-1966: send a staged file as a shared document. Mirrors the file send —
 * the returned message lands in the room caches under its client_msg_id and
 * the room list refreshes.
 */
export function useSendChatDocumentMessage(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      roomId: string;
      file: Blob;
      filename: string;
      share_level: ChatDocumentShareLevel;
      client_msg_id: string;
      reply_to_message_id?: string;
    }) => chat.sendChatDocumentMessage(workspaceId, input.roomId, input),
    onSuccess: (data, variables) => {
      applyChatMessageResponse(qc, workspaceId, variables.roomId, data, true);
      void qc.invalidateQueries({ queryKey: chatKeys.rooms(workspaceId) });
    },
  });
}

/**
 * UNI-2012: send an existing document into the room by id. Same landing as
 * the document upload: the returned card is inserted under its client_msg_id.
 */
export function useSendChatDocumentLink(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      roomId: string;
      document_id: string;
      share_level: ChatDocumentShareLevel;
      client_msg_id: string;
      reply_to_message_id?: string;
    }) => {
      const { roomId, ...body } = input;
      return chat.sendChatDocumentLink(workspaceId, roomId, body);
    },
    onSuccess: (data, variables) => {
      applyChatMessageResponse(qc, workspaceId, variables.roomId, data, true);
      void qc.invalidateQueries({ queryKey: chatKeys.rooms(workspaceId) });
    },
  });
}

/**
 * UNI-1966: convert the caller's file attachment into a document in place.
 * The server answers the same message id as kind "document", so the room
 * cache replaces the row, never duplicates it.
 */
export function useShareChatMessageAsDocument(workspaceId: string, roomId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { messageId: string; share_level: ChatDocumentShareLevel; client_msg_id: string }) =>
      chat.shareChatMessageAsDocument(workspaceId, roomId, input.messageId, {
        share_level: input.share_level,
        client_msg_id: input.client_msg_id,
      }),
    onSuccess: (data) => {
      applyChatMessageResponse(qc, workspaceId, roomId, data, false);
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
      void qc.invalidateQueries({ queryKey: chatKeys.pollVoters(workspaceId, variables.messageId) });
    },
  });
}

export function useAddChatPollOptionMessage(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { roomId: string; messageId: string; label: string }) =>
      chat.addChatPollOptionMessage(workspaceId, input.roomId, input.messageId, input.label),
    onSuccess: (data, variables) => {
      applyChatMessageResponse(qc, workspaceId, variables.roomId, data, false);
      void qc.invalidateQueries({ queryKey: chatKeys.pollVoters(workspaceId, variables.messageId) });
    },
  });
}

export function useChatPollVoters(
  workspaceId: string,
  roomId: string,
  messageId: string,
  enabled: boolean,
) {
  return useQuery({
    queryKey: chatKeys.pollVoters(workspaceId, messageId),
    queryFn: () => chat.getChatPollVoters(workspaceId, roomId, messageId),
    enabled: enabled && Boolean(workspaceId && roomId && messageId),
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
      void qc.invalidateQueries({ queryKey: chatKeys.rooms(workspaceId) });
      // Deleting a document message may trash its document or revoke its
      // grants (UNI-2012 D8), so the workspace's document reads are stale too.
      void qc.invalidateQueries({ queryKey: documentKeys.workspace(workspaceId) });
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

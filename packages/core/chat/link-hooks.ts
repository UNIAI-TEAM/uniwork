"use client";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import * as chat from "../api/endpoints/chat";
import type {
  CreateChatMessageLinkInput,
  CreateTaskFromMessageInput,
  SyncThreadTaskInput,
} from "../api/endpoints/chat-links";
import { useAuthStore } from "../auth/store";
import { taskKeys } from "../tasks/keys";
import { chatKeys } from "./chat-keys";
import {
  ensureRoomMessageLinksLoaded,
  messageIdsMissingFromCache,
  normalizeRoomLinkMessageIds,
  sliceRoomLinksCache,
  type RoomMessageLinksCache,
} from "./room-message-links-cache";
import { invalidateChatMessageLinks } from "./realtime-cache";

const EMPTY_ROOM_LINKS: RoomMessageLinksCache = new Map();

function invalidateMessageLinks(
  qc: ReturnType<typeof useQueryClient>,
  workspaceId: string,
  messageId: string,
) {
  invalidateChatMessageLinks(qc, workspaceId, messageId);
}

/**
 * Links for every message a room timeline shows. One React Query entry per room;
 * scrolling older history only fetches ids not already in cache.
 */
export function useChatRoomMessageLinks(
  workspaceId: string,
  roomId: string,
  messageIds: readonly string[],
  enabled = true,
) {
  const qc = useQueryClient();
  const authReady = useAuthStore((s) => s.status === "authed");
  const sortedIds = useMemo(() => normalizeRoomLinkMessageIds(messageIds), [messageIds]);
  const idsFingerprint = sortedIds.join(",");
  const roomKey = chatKeys.roomMessageLinksRoom(workspaceId, roomId);
  const active = !!workspaceId && !!roomId && sortedIds.length > 0 && authReady && enabled;

  const { data: roomCache = EMPTY_ROOM_LINKS } = useQuery({
    queryKey: roomKey,
    queryFn: (): RoomMessageLinksCache => qc.getQueryData<RoomMessageLinksCache>(roomKey) ?? new Map(),
    initialData: (): RoomMessageLinksCache => new Map(),
    staleTime: Number.POSITIVE_INFINITY,
    enabled: active,
  });

  const [fetching, setFetching] = useState(false);

  useEffect(() => {
    if (!active) return;
    const ids = idsFingerprint ? idsFingerprint.split(",") : [];
    const missing = messageIdsMissingFromCache(ids, qc.getQueryData<RoomMessageLinksCache>(roomKey));
    if (missing.length === 0) return;

    let cancelled = false;
    setFetching(true);
    void ensureRoomMessageLinksLoaded(qc, {
      workspaceId,
      roomId,
      messageIds: ids,
    })
      .catch(() => {
        // Task cards degrade to no links; the timeline does not surface this error.
      })
      .finally(() => {
        if (!cancelled) setFetching(false);
      });

    return () => {
      cancelled = true;
    };
  }, [active, idsFingerprint, qc, roomId, roomKey, workspaceId]);

  const data = useMemo(
    () => sliceRoomLinksCache(roomCache, sortedIds),
    [roomCache, sortedIds],
  );

  const isPending =
    active && (fetching || messageIdsMissingFromCache(sortedIds, roomCache).length > 0);

  return { data, isPending, isError: false, error: null };
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

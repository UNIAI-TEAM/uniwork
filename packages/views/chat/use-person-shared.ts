"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { listChatRoomMessages, type ChatMessageRecord } from "@uniwork/core/api/endpoints/chat";
import { useChatRooms } from "@uniwork/core/chat";
import { CHAT_HISTORY_PAGE_SIZE, olderRoomPageParam, type RoomMessagesPageParam } from "@uniwork/core/chat/room-timeline";
import { useOptionalWorkspace } from "../layout/workspace-context";
import { groupsInCommon, sharedItemsFromMessages } from "./chat-person-shared";

const SHARED_PAGE_CAP = 10;

/** Pages one room without moving the read cursor. */
export async function loadSharedRoomMessages(workspaceId: string, roomId: string): Promise<ChatMessageRecord[]> {
  const pages: ChatMessageRecord[][] = [];
  let pageParam: RoomMessagesPageParam = null;
  while (pages.length < SHARED_PAGE_CAP) {
    const page = await listChatRoomMessages(
      workspaceId,
      roomId,
      pageParam === null
        ? { limit: CHAT_HISTORY_PAGE_SIZE, mark_read: false }
        : { ...pageParam, limit: CHAT_HISTORY_PAGE_SIZE, mark_read: false },
    );
    pages.push(page);
    const next = olderRoomPageParam(page, pages, pageParam, CHAT_HISTORY_PAGE_SIZE);
    if (!next) break;
    pageParam = next;
  }
  return pages.flat();
}

/** Shared media from the conversation the avatar was opened in, and groups both people are in. */
export function usePersonShared(userId: string | undefined, roomId: string | null, enabled: boolean) {
  const workspaceId = useOptionalWorkspace()?.workspace.id ?? "";
  const roomsQuery = useChatRooms(workspaceId);
  const rooms = roomsQuery.data;
  const groups = useMemo(() => (userId ? groupsInCommon(rooms ?? [], userId) : []), [rooms, userId]);
  const mediaQuery = useQuery({
    queryKey: ["chat-person-shared", workspaceId, roomId],
    queryFn: () => loadSharedRoomMessages(workspaceId, roomId!),
    enabled: enabled && !!workspaceId && !!roomId,
    staleTime: 30_000,
  });
  const items = useMemo(
    () => sharedItemsFromMessages(mediaQuery.data ?? [], userId),
    [mediaQuery.data, userId],
  );
  const loading =
    enabled && ((!!workspaceId && roomsQuery.isPending) || (!!roomId && mediaQuery.isPending));

  return { ...items, groups, loading, failed: mediaQuery.isError };
}

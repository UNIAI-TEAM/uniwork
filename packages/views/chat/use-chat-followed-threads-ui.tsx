"use client";

import { useCallback, useState, type ReactNode } from "react";
import type { ChatRoomRecord, ChatThreadRecord } from "@uniwork/core/api/endpoints/chat";
import type { ChatContact } from "@uniwork/core/chat/contacts-store";
import type { GroupChat } from "@uniwork/core/chat/groups-store";
import { ChatFollowedThreadsSheet } from "./chat-followed-threads-sheet";
import { resolveChatRoomTarget } from "./chat-room-target";
import type { ChatSidebarTarget } from "./chat-sidebar-types";

/** Followed-thread list sheet and navigation into the room anchor. */
export function useChatFollowedThreadsUi({
  workspaceId,
  workspaceRoomId,
  workspaceTitle,
  channels,
  groups,
  contacts,
  nicknamesByUserId,
  onTargetChange,
  onJumpToMessage,
}: {
  workspaceId: string;
  workspaceRoomId: string | null;
  workspaceTitle: string;
  channels: ChatRoomRecord[];
  groups: GroupChat[];
  contacts: ChatContact[];
  nicknamesByUserId: Record<string, string>;
  onTargetChange: (target: ChatSidebarTarget) => void;
  onJumpToMessage: (messageId: string) => void;
}): { openList: () => void; sheet: ReactNode } {
  const [listOpen, setListOpen] = useState(false);

  const onOpenThread = useCallback(
    (thread: ChatThreadRecord) => {
      const resolved = resolveChatRoomTarget(thread.room_id, {
        workspaceRoomId,
        workspaceTitle,
        channels,
        groups,
        contacts,
        nicknamesByUserId,
      });
      if (!resolved) return;
      onTargetChange(resolved.target);
      onJumpToMessage(thread.thread_root_id);
    },
    [
      workspaceRoomId,
      workspaceTitle,
      channels,
      groups,
      contacts,
      nicknamesByUserId,
      onTargetChange,
      onJumpToMessage,
    ],
  );

  return {
    openList: () => setListOpen(true),
    sheet: (
      <ChatFollowedThreadsSheet
        open={listOpen}
        onOpenChange={setListOpen}
        workspaceId={workspaceId}
        onOpenThread={onOpenThread}
      />
    ),
  };
}

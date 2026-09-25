"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatRoomRecord } from "@uniwork/core/api/endpoints/chat";
import type { ChatContact } from "@uniwork/core/chat/contacts-store";
import type { GroupChat } from "@uniwork/core/chat/groups-store";
import type { ChatSidebarTarget } from "./chat-sidebar-types";
import { useChatRoomUrl, useChatWideLayout } from "./use-chat-room-url";
import { useChatDmDeepLink } from "./use-chat-dm-deep-link";

const TITLE_SELECTOR = "[data-chat-conversation-title]";
const EXPAND_SELECTOR = "[data-chat-sidebar-expand]";
const COLLAPSE_SELECTOR = "[data-chat-sidebar-collapse]";
const ACTIVE_ROW_SELECTOR = '[data-chat-sidebar-row][aria-current="true"]';
const TAB_STOP_ROW_SELECTOR = '[data-chat-sidebar-row][tabindex="0"]';

function targetRoomId(target: ChatSidebarTarget, workspaceRoomId: string | null): string | null {
  switch (target.kind) {
    case "workspace":
      return workspaceRoomId;
    case "dm":
      return target.contact.dm_room_id ?? null;
    case "group":
      return target.group.room_id;
    case "channel":
      return target.channel.id;
  }
}

/** Focus the first match inside `root` that can take focus (a hidden one cannot). */
function focusIn(root: HTMLElement | null, selector: string): boolean {
  for (const el of Array.from(root?.querySelectorAll<HTMLElement>(selector) ?? [])) {
    el.focus();
    if (document.activeElement === el) return true;
  }
  return false;
}

/**
 * Which panel shows (list, conversation, both), where focus goes when that
 * changes, and the URL that remembers the open room. Keyboard and screen
 * reader users land on the thing that just appeared: the room title after
 * opening a conversation on a phone, the open row after going back, the
 * counterpart toggle after hiding or showing the list.
 */
export function useChatPagePanels({
  setTarget,
  activeRoomId,
  workspaceRoomId,
  contacts,
  groups,
  channels,
  roomsReady,
  showLoading,
}: {
  setTarget: React.Dispatch<React.SetStateAction<ChatSidebarTarget>>;
  activeRoomId: string | null;
  workspaceRoomId: string | null;
  contacts: ChatContact[];
  groups: GroupChat[];
  channels: ChatRoomRecord[];
  roomsReady: boolean;
  showLoading: boolean;
}) {
  const wide = useChatWideLayout();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const conversationRef = useRef<HTMLDivElement>(null);

  const resolveRoom = (roomId: string): boolean => {
    if (roomId === workspaceRoomId) {
      setTarget({ kind: "workspace" });
      return true;
    }
    const channel = channels.find((entry) => entry.id === roomId);
    if (channel) {
      setTarget({ kind: "channel", channel });
      return true;
    }
    const group = groups.find((entry) => entry.room_id === roomId);
    if (group) {
      setTarget({ kind: "group", group });
      return true;
    }
    const contact = contacts.find((entry) => entry.dm_room_id === roomId);
    if (contact) {
      setTarget({ kind: "dm", contact });
      return true;
    }
    return false;
  };

  const { conversationOpen, openRoom, backToList } = useChatRoomUrl({
    activeRoomId,
    wide,
    resolveRoom,
    roomsReady,
  });

  const focusTitlePending = useRef(false);
  const focusRowPending = useRef(false);

  const handleTargetChange = useCallback(
    (next: ChatSidebarTarget) => {
      setTarget(next);
      openRoom(targetRoomId(next, workspaceRoomId));
      if (!wide) focusTitlePending.current = true;
    },
    [openRoom, setTarget, wide, workspaceRoomId],
  );
  // `?dm=<userId>` from outside Chat opens like a row chosen here.
  useChatDmDeepLink(handleTargetChange, roomsReady);

  const handleBackToConversationList = useCallback(() => {
    focusRowPending.current = true;
    focusTitlePending.current = false;
    backToList();
  }, [backToList]);

  const handleToggleSidebar = useCallback(() => {
    setSidebarCollapsed((collapsed) => !collapsed);
  }, []);

  // Phone: the conversation just appeared → its title; the list just came
  // back (our back control or the system Back) → the open row.
  const prevOpen = useRef(conversationOpen);
  useEffect(() => {
    const wasOpen = prevOpen.current;
    prevOpen.current = conversationOpen;
    if (wide) return;
    if (wasOpen && !conversationOpen) focusRowPending.current = true;
    if (focusRowPending.current && !conversationOpen) {
      if (
        focusIn(sidebarRef.current, ACTIVE_ROW_SELECTOR) ||
        focusIn(sidebarRef.current, TAB_STOP_ROW_SELECTOR)
      ) {
        focusRowPending.current = false;
      }
    }
    if (focusTitlePending.current && conversationOpen && !showLoading) {
      if (focusIn(conversationRef.current, TITLE_SELECTOR)) focusTitlePending.current = false;
    }
  }, [conversationOpen, showLoading, wide, activeRoomId]);

  // Wide: hiding the list hands focus to "show list", and back again.
  const prevCollapsed = useRef(sidebarCollapsed);
  useEffect(() => {
    if (prevCollapsed.current === sidebarCollapsed) return;
    prevCollapsed.current = sidebarCollapsed;
    if (!wide) return;
    if (sidebarCollapsed) focusIn(conversationRef.current, EXPAND_SELECTOR);
    else focusIn(sidebarRef.current, COLLAPSE_SELECTOR);
  }, [sidebarCollapsed, wide]);

  return {
    sidebarCollapsed,
    sidebarRef,
    conversationRef,
    showMobileList: !conversationOpen,
    showMobileChat: conversationOpen,
    handleTargetChange,
    handleBackToConversationList,
    handleToggleSidebar,
  };
}

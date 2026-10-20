"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { defaultStorage } from "@uniwork/core/platform";
import type { ChatRoomRecord } from "@uniwork/core/api/endpoints/chat";
import type { ChatContact } from "@uniwork/core/chat/contacts-store";
import type { GroupChat } from "@uniwork/core/chat/groups-store";
import type { ChatMessage } from "./chat-messages";
import type { ChatSidebarTarget } from "./chat-sidebar-types";
import { useChatRoomUrl, useChatWideLayout } from "./use-chat-room-url";
import { useChatDmDeepLink } from "./use-chat-dm-deep-link";
import { useOptionalNavigation } from "../navigation";

const TITLE_SELECTOR = "[data-chat-conversation-title]";
const EXPAND_SELECTOR = "[data-chat-sidebar-expand]";
const COLLAPSE_SELECTOR = "[data-chat-sidebar-collapse]";
const ACTIVE_ROW_SELECTOR = '[data-chat-sidebar-row][aria-current="true"]';
const TAB_STOP_ROW_SELECTOR = '[data-chat-sidebar-row][tabindex="0"]';
/** This device's last choice for the docked info panel ("closed" once hidden). */
const INFO_PANEL_KEY = "uniwork_chat_info_panel";
/** The info panel docks only when the conversation keeps ~480px beside its 300px. */
const INFO_DOCK_MIN_WIDTH = 780;

function readInfoPref(): boolean {
  try {
    return defaultStorage.getItem(INFO_PANEL_KEY) !== "closed";
  } catch {
    return true;
  }
}

function writeInfoPref(open: boolean) {
  try {
    if (open) defaultStorage.removeItem(INFO_PANEL_KEY);
    else defaultStorage.setItem(INFO_PANEL_KEY, "closed");
  } catch {
    // Storage blocked: the choice lasts for this page only.
  }
}

/** The width of `ref`'s element, or null before the first measure (and where nothing measures). */
function useElementWidth(ref: React.RefObject<HTMLElement | null>): number | null {
  const [width, setWidth] = useState<number | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width;
      if (next) setWidth(Math.round(next));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

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

/**
 * A reload or a link names a room in `?room=`: until that room is the one
 * open, the page shows no room — opening the workspace room meanwhile would
 * mark it read. Not pending once the rooms have loaded without that id (it is
 * gone; the URL drops it) or when the URL names the workspace room itself.
 */
export function isUrlRoomPending({
  targetKind,
  urlRoomId,
  workspaceRoomId,
  roomsLoaded,
  roomIds,
}: {
  targetKind: ChatSidebarTarget["kind"];
  urlRoomId: string | null;
  workspaceRoomId: string | null;
  roomsLoaded: boolean;
  roomIds: readonly string[];
}): boolean {
  if (targetKind !== "workspace" || !urlRoomId || urlRoomId === workspaceRoomId) return false;
  return !roomsLoaded || roomIds.includes(urlRoomId);
}

/** `isUrlRoomPending` for the page: the URL's room against the rooms the list can open (what resolveRoom looks in). */
export function useUrlRoomPending({
  targetKind,
  workspaceRoomId,
  roomsLoaded,
  channels,
  groups,
  contacts,
}: {
  targetKind: ChatSidebarTarget["kind"];
  workspaceRoomId: string | null;
  roomsLoaded: boolean;
  channels: ChatRoomRecord[];
  groups: GroupChat[];
  contacts: ChatContact[];
}): boolean {
  const urlRoomId = useOptionalNavigation()?.searchParams.get("room") ?? null;
  const roomIds = useMemo(
    () => [
      ...channels.map((channel) => channel.id),
      ...groups.map((group) => group.room_id),
      ...contacts.flatMap((contact) => (contact.dm_room_id ? [contact.dm_room_id] : [])),
    ],
    [channels, groups, contacts],
  );
  return isUrlRoomPending({ targetKind, urlRoomId, workspaceRoomId, roomsLoaded, roomIds });
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
 *
 * From lg a thread opens in a panel beside the timeline (`sideThread`);
 * below lg there is no room for it and the timeline opens it in place. A
 * room switch, or the window narrowing past lg, closes the side thread. The
 * settings sheets are modal and slide over it: while one is open nothing
 * opens a thread, and closing it finds the thread where it was.
 *
 * The room's info panel docks beside the conversation when the pane is wide
 * enough (open unless this device closed it last time), and otherwise slides
 * over it, opened only on request and closed by a room switch. A side thread
 * takes the panel's column while it is open.
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
  const [sideThread, setSideThread] = useState<ChatMessage | null>(null);
  useEffect(() => {
    setSideThread(null);
  }, [activeRoomId, wide]);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const conversationRef = useRef<HTMLDivElement>(null);
  const paneWidth = useElementWidth(conversationRef);
  const infoDocked = wide && (paneWidth === null || paneWidth >= INFO_DOCK_MIN_WIDTH);
  const [infoPref, setInfoPref] = useState(readInfoPref);
  const [infoOverlayOpen, setInfoOverlayOpen] = useState(false);
  useEffect(() => {
    setInfoOverlayOpen(false);
  }, [activeRoomId, infoDocked]);
  const infoOpen = infoDocked ? infoPref : infoOverlayOpen;
  const setInfoOpen = useCallback(
    (open: boolean) => {
      if (!infoDocked) {
        setInfoOverlayOpen(open);
        return;
      }
      setInfoPref(open);
      writeInfoPref(open);
    },
    [infoDocked],
  );

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
    /** Threads open beside the timeline (lg and up) rather than in it. */
    threadBeside: wide,
    sideThread: wide ? sideThread : null,
    setSideThread,
    /** The info panel shows (docked, or over the conversation when `infoDocked` is false). */
    infoOpen,
    infoDocked,
    setInfoOpen,
  };
}

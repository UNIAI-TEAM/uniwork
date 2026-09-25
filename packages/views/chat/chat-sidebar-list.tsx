"use client";

import { useVirtualizer } from "@tanstack/react-virtual";
import { useCallback, useRef, useState, type KeyboardEvent } from "react";
import type { ChatContact } from "@uniwork/core/chat/contacts-store";
import type { ChatRoomPreference } from "@uniwork/core/chat/room-preferences-store";
import type { ChatRoomPreview } from "./chat-sidebar-preview";
import type { ChatSidebarTarget } from "./chat-sidebar-types";
import type { UnifiedSidebarEntry } from "./chat-sidebar-unified";
import type { MemberAvatarUrlMap } from "./chat-member-avatar";
import {
  ChatSidebarUnifiedRow,
  isSidebarEntryActive,
  sidebarEntryRoomId,
  type SidebarRowLabels,
} from "./chat-sidebar-unified-row";

/** Past this many rows only the visible slice is mounted. */
const SIDEBAR_VIRTUALIZE_AFTER = 100;
/** A row: 32px mark, a name line and a preview line, 8px padding each side. */
const ROW_ESTIMATE_PX = 54;

const ROW_SELECTOR = "[data-chat-sidebar-row]";
const NAV_KEYS = new Set(["ArrowDown", "ArrowUp", "Home", "End"]);

type RowData = {
  entries: UnifiedSidebarEntry[];
  target: ChatSidebarTarget;
  onTargetChange: (target: ChatSidebarTarget) => void;
  workspaceTitle: string;
  contacts: ChatContact[];
  currentUserId: string;
  nicknamesByUserId: Record<string, string>;
  roomPreviewsByRoomId: Record<string, ChatRoomPreview>;
  unreadByRoomId: Record<string, number>;
  mentionUnreadByRoomId: Record<string, number>;
  unreadBadgesReady: boolean;
  preferencesByRoomId: Record<string, ChatRoomPreference>;
  labels: SidebarRowLabels;
  memberAvatarByUserId: MemberAvatarUrlMap;
};

/**
 * The conversation rows. One row is in the tab order (the open one, else the
 * first); ↑/↓/Home/End move between rows and Enter opens one, as in a menu.
 * A long list mounts only what is on screen, and the keys still reach rows
 * that are not mounted yet.
 */
export function ChatSidebarList(props: RowData) {
  const { entries, target } = props;
  const scrollRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [focusIndex, setFocusIndex] = useState<number | null>(null);
  const virtual = entries.length > SIDEBAR_VIRTUALIZE_AFTER;

  const activeIndex = entries.findIndex((entry) => isSidebarEntryActive(entry, target));
  const tabStop =
    focusIndex !== null && focusIndex < entries.length ? focusIndex : Math.max(activeIndex, 0);

  const virtualizer = useVirtualizer({
    count: virtual ? entries.length : 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_ESTIMATE_PX,
    overscan: 8,
  });

  const focusRow = useCallback((index: number) => {
    // A virtual row may mount a frame after scrollToIndex; try a few frames.
    const attempt = (left: number) => {
      const row = listRef.current?.querySelector<HTMLElement>(`[data-chat-sidebar-row="${index}"]`);
      if (row) row.focus();
      else if (left > 0) requestAnimationFrame(() => attempt(left - 1));
    };
    attempt(4);
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    if (!NAV_KEYS.has(event.key) || entries.length === 0) return;
    const focused = (event.target as HTMLElement).closest?.(ROW_SELECTOR);
    if (!focused) return;
    event.preventDefault();
    const current = Number(focused.getAttribute("data-chat-sidebar-row"));
    const last = entries.length - 1;
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? last
          : event.key === "ArrowDown"
            ? Math.min(current + 1, last)
            : Math.max(current - 1, 0);
    setFocusIndex(next);
    if (virtual) virtualizer.scrollToIndex(next, { align: "auto" });
    focusRow(next);
  };

  // A virtual list may not have the tab-stop row mounted; then the first
  // mounted row takes the stop so Tab still lands in the list.
  const virtualItems = virtual ? virtualizer.getVirtualItems() : [];
  const rowTabStop =
    virtual && virtualItems.length > 0 && !virtualItems.some((item) => item.index === tabStop)
      ? (virtualItems[0]?.index ?? tabStop)
      : tabStop;

  const renderRow = (entry: UnifiedSidebarEntry, index: number) => {
    const roomId = sidebarEntryRoomId(entry);
    const pref = roomId ? props.preferencesByRoomId[roomId] : undefined;
    return (
      <ChatSidebarUnifiedRow
        entry={entry}
        active={index === activeIndex}
        onTargetChange={props.onTargetChange}
        workspaceTitle={props.workspaceTitle}
        contacts={props.contacts}
        currentUserId={props.currentUserId}
        nicknamesByUserId={props.nicknamesByUserId}
        preview={roomId ? props.roomPreviewsByRoomId[roomId] : undefined}
        unread={roomId ? (props.unreadByRoomId[roomId] ?? 0) : 0}
        mentionUnread={roomId ? (props.mentionUnreadByRoomId[roomId] ?? 0) : 0}
        unreadBadgesReady={props.unreadBadgesReady}
        pinned={Boolean(pref?.pinned)}
        notificationsMuted={Boolean(pref?.notificationsMuted)}
        labels={props.labels}
        rowIndex={index}
        tabIndex={index === rowTabStop ? 0 : -1}
        onRowFocus={setFocusIndex}
        memberAvatarByUserId={props.memberAvatarByUserId}
      />
    );
  };

  if (!virtual) {
    return (
      // The list only forwards arrow keys to its row buttons; the rows are the interactive elements.
      // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
      <ul
        ref={listRef}
        className="-mx-1 min-h-0 shrink space-y-px overflow-y-auto px-1 py-1"
        onKeyDown={onKeyDown}
      >
        {entries.map((entry, index) => (
          <li key={entry.key}>{renderRow(entry, index)}</li>
        ))}
      </ul>
    );
  }

  return (
    <div ref={scrollRef} className="-mx-1 min-h-0 shrink overflow-y-auto px-1 py-1">
      {/* The list only forwards arrow keys to its row buttons; the rows are the interactive elements. */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
      <ul
        ref={listRef}
        className="relative w-full"
        style={{ height: `${virtualizer.getTotalSize()}px` }}
        onKeyDown={onKeyDown}
      >
        {virtualItems.map((item) => {
          const entry = entries[item.index];
          if (!entry) return null;
          return (
            <li
              key={entry.key}
              data-index={item.index}
              ref={virtualizer.measureElement}
              aria-setsize={entries.length}
              aria-posinset={item.index + 1}
              className="absolute top-0 left-0 w-full pb-px"
              style={{ transform: `translateY(${item.start}px)` }}
            >
              {renderRow(entry, item.index)}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

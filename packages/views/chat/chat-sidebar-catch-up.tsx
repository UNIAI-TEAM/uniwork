"use client";

import { ChevronRight, Sparkle } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ChatRoomRecord } from "@uniwork/core/api/endpoints/chat";
import type { ChatContact } from "@uniwork/core/chat/contacts-store";
import type { GroupChat } from "@uniwork/core/chat/groups-store";
import { resolveChatRoomTarget } from "./chat-room-target";
import type { ChatSidebarTarget } from "./chat-sidebar-types";

type QuickCatchUp = {
  /** Unread messages across the conversations in the list. */
  total: number;
  /** Conversations with at least one unread message. */
  rooms: number;
  /** The conversation with the most unread messages: the one the card opens and summarises. */
  top: { roomId: string; target: ChatSidebarTarget; title: string } | null;
};

/**
 * What "Bắt kịp nhanh" offers, from the unread counts already on the client.
 * The catch-up brief is per room, so the card opens the conversation with
 * the most unread messages (the first of equals) and summarises that one.
 * Rooms the list cannot show are left out of the counts.
 */
export function pickQuickCatchUp({
  unreadByRoomId,
  workspaceRoomId,
  workspaceTitle,
  channels,
  groups,
  contacts,
  nicknamesByUserId,
}: {
  unreadByRoomId: Record<string, number>;
  workspaceRoomId: string | null;
  workspaceTitle: string;
  channels: ChatRoomRecord[];
  groups: GroupChat[];
  contacts: ChatContact[];
  nicknamesByUserId: Record<string, string>;
}): QuickCatchUp {
  const resolve = (roomId: string): { target: ChatSidebarTarget; title: string } | null =>
    resolveChatRoomTarget(roomId, {
      workspaceRoomId,
      workspaceTitle,
      channels,
      groups,
      contacts,
      nicknamesByUserId,
    });
  let total = 0;
  let rooms = 0;
  let top: (QuickCatchUp["top"] & { count: number }) | null = null;
  for (const [roomId, count] of Object.entries(unreadByRoomId)) {
    if (count <= 0) continue;
    const room = resolve(roomId);
    if (!room) continue;
    total += count;
    rooms += 1;
    if (!top || count > top.count) top = { roomId, count, ...room };
  }
  return { total, rooms, top: top ? { roomId: top.roomId, target: top.target, title: top.title } : null };
}

/** The first thing in the list: how much is unread, and a tap to UNI's brief of the busiest room. */
export function SidebarCatchUpCard({
  catchUp,
  onOpen,
}: {
  catchUp: QuickCatchUp;
  onOpen: (target: ChatSidebarTarget, roomId: string) => void;
}) {
  const { t } = useTranslation();
  const { top } = catchUp;
  const content = (
    <>
      <span className="flex size-9 shrink-0 items-center justify-center rounded-control bg-primary text-primary-foreground">
        <Sparkle aria-hidden className="size-4.5" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="font-display text-body leading-4.5 font-bold text-foreground">{t("chat.sidebar_catch_up_title")}</span>
        <span className="text-label leading-4.25 text-muted-foreground">
          {top
            ? t("chat.sidebar_catch_up_body", { count: catchUp.total, rooms: catchUp.rooms })
            : t("chat.sidebar_catch_up_none")}
        </span>
        {/* The card opens the busiest room; the canvas draws no line for it, so only a screen reader hears where. */}
        {top ? <span className="sr-only">{t("chat.sidebar_catch_up_target", { name: top.title })}</span> : null}
      </span>
    </>
  );
  const box = "mb-1.5 flex w-full shrink-0 items-center gap-3 rounded-[14px] border border-brand/25 bg-brand-subtle px-3.5 py-3 text-left";
  if (!top) return <div className={box}>{content}</div>;
  return (
    <button
      type="button"
      className={`${box} transition-colors duration-(--duration-fast) hover:bg-brand/15`}
      onClick={() => onOpen(top.target, top.roomId)}
    >
      {content}
      <ChevronRight aria-hidden className="size-4.5 shrink-0 text-faint-foreground" />
    </button>
  );
}

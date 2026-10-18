"use client";

import { House, Lock } from "lucide-react";
import { memo, useCallback, useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { ChatContact } from "@uniwork/core/chat/contacts-store";
import { displayLabelForChatContact } from "@uniwork/core/chat/contacts-store";
import { selectIsUserOnline, usePresenceStore } from "@uniwork/core/chat/presence-store";
import { ActorAvatar } from "@uniwork/ui/components/common/actor-avatar";
import { tintSolidClass, type Tint } from "@uniwork/ui/components/common/icon-tile";
import { cn } from "@uniwork/ui/lib/utils";
import { identityTint } from "../people/identity-tint";
import { initialsOf, roomInitialsOf } from "./chat-initials";
import { lookupMemberAvatarUrl, type MemberAvatarUrlMap } from "./chat-member-avatar";
import { ChatRoomPhoto } from "./chat-room-mark";
import type { ChatRoomPreview } from "./chat-sidebar-preview";
import { SidebarNavItem, type SidebarPreviewOptions } from "./chat-sidebar-rows";
import type { ChatSidebarTarget } from "./chat-sidebar-types";
import type { UnifiedSidebarEntry } from "./chat-sidebar-unified";

/** Labels every row's preview line shares; the sidebar builds this once. */
export type SidebarRowLabels = Omit<SidebarPreviewOptions, "isGroup" | "nicknamesByUserId" | "currentUserId">;

/* The canvas' 50px face: people are circles, rooms 16px-rounded squares, both
   with white initials (or the room's glyph) on the row's own colour. */
const FACE = "size-12.5 shrink-0 font-display text-title-sm font-bold";

/** A room's face: its uploaded photo, else its initials or glyph on its colour. */
function RoomFace({ tint, imageUrl, children }: { tint: Tint; imageUrl?: string; children: ReactNode }) {
  return (
    <ChatRoomPhoto src={imageUrl} className="size-12.5 rounded-xl">
      <span
        aria-hidden
        className={cn(FACE, "flex items-center justify-center rounded-xl [&_svg]:size-5.5", tintSolidClass[tint])}
      >
        {children}
      </span>
    </ChatRoomPhoto>
  );
}

/**
 * A DM row's avatar subscribes to one boolean — this person's presence —
 * rather than the whole presence map, so a colleague coming online repaints
 * their own row and nothing else.
 */
function DmPresenceAvatar({
  userId,
  label,
  memberAvatarByUserId,
}: {
  userId: string;
  label: string;
  memberAvatarByUserId: MemberAvatarUrlMap;
}) {
  const { t } = useTranslation();
  const online = usePresenceStore((state) => selectIsUserOnline(state, userId));
  return (
    <span className="relative inline-flex shrink-0">
      <ActorAvatar
        name={label}
        initials={initialsOf(label)}
        avatarUrl={lookupMemberAvatarUrl(memberAvatarByUserId, userId)}
        size="fluid"
        // Initials sit on the person's own colour, as they do across the app.
        className={cn(FACE, tintSolidClass[identityTint(userId)])}
      />
      {online ? (
        <>
          {/* The ring is cut from the row's fill (--row-fill), as the canvas draws it. */}
          <span
            aria-hidden
            className="absolute right-0 bottom-0 size-3.5 rounded-full border-[2.5px] border-(--row-fill) bg-success-solid"
          />
          <span className="sr-only">{t("chat.presence_online")}</span>
        </>
      ) : null}
    </span>
  );
}

/** The room a sidebar entry opens; null for a DM whose room does not exist yet. */
export function sidebarEntryRoomId(entry: UnifiedSidebarEntry): string | null {
  switch (entry.kind) {
    case "workspace":
      return entry.roomId;
    case "channel":
      return entry.channel.id;
    case "group":
      return entry.group.room_id;
    case "dm":
      return entry.contact.dm_room_id ?? null;
  }
}

export function isSidebarEntryActive(entry: UnifiedSidebarEntry, target: ChatSidebarTarget): boolean {
  switch (entry.kind) {
    case "workspace":
      return target.kind === "workspace";
    case "channel":
      return target.kind === "channel" && target.channel.id === entry.channel.id;
    case "group":
      return target.kind === "group" && target.group.id === entry.group.id;
    case "dm":
      return target.kind === "dm" && target.contact.user_id === entry.contact.user_id;
  }
}

/**
 * Renders one flat conversation row for the unified sidebar list. Every prop
 * is either a primitive for this row or a reference the sidebar keeps stable,
 * so typing in the composer or an unread bump elsewhere skips this row.
 */
export const ChatSidebarUnifiedRow = memo(function ChatSidebarUnifiedRow({
  entry,
  active,
  onTargetChange,
  workspaceTitle,
  contacts,
  currentUserId,
  nicknamesByUserId,
  preview,
  unread,
  mentionUnread,
  unreadBadgesReady,
  pinned,
  notificationsMuted,
  labels,
  rowIndex,
  tabIndex,
  onRowFocus,
  memberAvatarByUserId,
  typingNameByUserId,
  peerReadAt,
}: {
  entry: UnifiedSidebarEntry;
  active: boolean;
  onTargetChange: (target: ChatSidebarTarget) => void;
  workspaceTitle: string;
  contacts: ChatContact[];
  currentUserId: string;
  nicknamesByUserId: Record<string, string>;
  memberAvatarByUserId: MemberAvatarUrlMap;
  preview: ChatRoomPreview | undefined;
  unread: number;
  mentionUnread: number;
  unreadBadgesReady: boolean;
  pinned: boolean;
  notificationsMuted: boolean;
  labels: SidebarRowLabels;
  rowIndex: number;
  tabIndex: number;
  onRowFocus: (rowIndex: number) => void;
  typingNameByUserId: Record<string, string>;
  peerReadAt?: string;
}) {
  const { t } = useTranslation();
  const isGroup = entry.kind !== "dm";
  const previewOptions = useMemo(
    (): SidebarPreviewOptions => ({ ...labels, currentUserId, nicknamesByUserId, isGroup }),
    [labels, currentUserId, nicknamesByUserId, isGroup],
  );
  const roomId = sidebarEntryRoomId(entry);
  const onClick = useCallback(() => {
    switch (entry.kind) {
      case "workspace":
        onTargetChange({ kind: "workspace" });
        return;
      case "channel":
        onTargetChange({ kind: "channel", channel: entry.channel });
        return;
      case "group":
        onTargetChange({ kind: "group", group: entry.group });
        return;
      case "dm":
        onTargetChange({ kind: "dm", contact: entry.contact });
    }
  }, [entry, onTargetChange]);

  const shared = {
    active,
    onClick,
    rowIndex,
    tabIndex,
    onRowFocus,
    preview,
    roomId,
    previewOptions,
    unread,
    mentionUnread,
    unreadBadgesReady,
    pinned,
    notificationsMuted,
    typingNameByUserId,
    peerReadAt,
  };

  if (entry.kind === "workspace") {
    return (
      <SidebarNavItem
        {...shared}
        avatar={
          <RoomFace tint="blue">
            <House />
          </RoomFace>
        }
        title={workspaceTitle}
        fallbackSubtitle={t("chat.workspace_room_subtitle")}
        contacts={contacts}
      />
    );
  }

  if (entry.kind === "channel") {
    const channel = entry.channel;
    const privateChannel = channel.visibility === "private";
    return (
      <SidebarNavItem
        {...shared}
        avatar={<RoomFace tint={identityTint(channel.id)}>{privateChannel ? <Lock /> : "#"}</RoomFace>}
        title={privateChannel ? channel.name : `# ${channel.name}`}
      />
    );
  }

  if (entry.kind === "group") {
    return (
      <SidebarNavItem
        {...shared}
        avatar={
          <RoomFace tint={identityTint(entry.group.id)} imageUrl={entry.group.avatar_url}>
            {roomInitialsOf(entry.group.name)}
          </RoomFace>
        }
        title={entry.group.name}
        contacts={contacts}
      />
    );
  }

  const label = displayLabelForChatContact(entry.contact, nicknamesByUserId);
  return (
    <SidebarNavItem
      {...shared}
      avatar={
        <DmPresenceAvatar
          userId={entry.contact.user_id}
          label={label}
          memberAvatarByUserId={memberAvatarByUserId}
        />
      }
      title={label}
      contacts={contacts}
    />
  );
});

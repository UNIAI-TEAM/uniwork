"use client";

import { Hash, Home, Lock, Users } from "lucide-react";
import type { ChatContact } from "@uniwork/core/chat/contacts-store";
import { displayLabelForChatContact } from "@uniwork/core/chat/contacts-store";
import { usePresenceStore } from "@uniwork/core/chat/presence-store";
import { normalizeTypingUserId } from "@uniwork/core/chat/typing-user-id";
import { ChatPresenceAvatar } from "./chat-presence-avatar";
import type { ChatRoomPreview } from "./chat-sidebar-preview";
import { SidebarNavItem } from "./chat-sidebar-rows";
import type { ChatSidebarTarget } from "./chat-sidebar-types";
import type { UnifiedSidebarEntry } from "./chat-sidebar-unified";

function initialOf(name: string): string {
  return name.trim().slice(0, 1).toUpperCase() || "?";
}

/** Renders one flat conversation row for the unified sidebar list. */
export function ChatSidebarUnifiedRow({
  entry,
  target,
  onTargetChange,
  workspaceTitle,
  workspaceRoomId,
  contacts,
  currentUserId,
  nicknamesByUserId,
  roomPreviewsByRoomId,
  unreadByRoomId,
  mentionUnreadByRoomId,
  unreadBadgesReady,
  isRoomPinned,
  isRoomNotificationsMuted,
  youLabel,
  voiceCallPreviewLabel,
  voiceMessagePreviewLabel,
  fileMessagePreviewLabel,
  yesterdayLabel,
}: {
  entry: UnifiedSidebarEntry;
  target: ChatSidebarTarget;
  onTargetChange: (target: ChatSidebarTarget) => void;
  workspaceTitle: string;
  workspaceRoomId: string | null;
  contacts: ChatContact[];
  currentUserId: string;
  nicknamesByUserId: Record<string, string>;
  roomPreviewsByRoomId: Record<string, ChatRoomPreview>;
  unreadByRoomId: Record<string, number>;
  mentionUnreadByRoomId: Record<string, number>;
  unreadBadgesReady: boolean;
  isRoomPinned: (roomId: string | null | undefined) => boolean;
  isRoomNotificationsMuted: (roomId: string | null | undefined) => boolean;
  youLabel: string;
  voiceCallPreviewLabel: string;
  voiceMessagePreviewLabel: string;
  fileMessagePreviewLabel: string;
  yesterdayLabel: string;
}) {
  const onlineUserIds = usePresenceStore((state) => state.onlineUserIds);
  const previewOpts = {
    currentUserId,
    youLabel,
    voiceCallLabel: voiceCallPreviewLabel,
    voiceMessageLabel: voiceMessagePreviewLabel,
    fileMessageLabel: fileMessagePreviewLabel,
    yesterdayLabel,
    nicknamesByUserId,
  };

  if (entry.kind === "workspace") {
    return (
      <SidebarNavItem
        active={target.kind === "workspace"}
        onClick={() => onTargetChange({ kind: "workspace" })}
        avatar={
          <span
            className="flex size-9 shrink-0 items-center justify-center text-muted-foreground"
            aria-hidden
          >
            <Home className="size-4" />
          </span>
        }
        title={workspaceTitle}
        preview={workspaceRoomId ? roomPreviewsByRoomId[workspaceRoomId] : undefined}
        roomId={workspaceRoomId}
        contacts={contacts}
        previewOptions={{ ...previewOpts, isGroup: true }}
        unread={workspaceRoomId ? (unreadByRoomId[workspaceRoomId] ?? 0) : 0}
        mentionUnread={workspaceRoomId ? (mentionUnreadByRoomId[workspaceRoomId] ?? 0) : 0}
        unreadBadgesReady={unreadBadgesReady}
        pinned={isRoomPinned(workspaceRoomId)}
        notificationsMuted={isRoomNotificationsMuted(workspaceRoomId)}
      />
    );
  }

  if (entry.kind === "channel") {
    const channel = entry.channel;
    const privateChannel = channel.visibility === "private";
    return (
      <SidebarNavItem
        active={target.kind === "channel" && target.channel.id === channel.id}
        onClick={() => onTargetChange({ kind: "channel", channel })}
        avatar={
          <span
            className="flex size-9 shrink-0 items-center justify-center text-muted-foreground"
            aria-hidden
          >
            {privateChannel ? <Lock className="size-4" /> : <Hash className="size-4" />}
          </span>
        }
        title={privateChannel ? channel.name : `#${channel.name}`}
        preview={roomPreviewsByRoomId[channel.id]}
        roomId={channel.id}
        contacts={[]}
        previewOptions={{ ...previewOpts, isGroup: true }}
        unread={unreadByRoomId[channel.id] ?? 0}
        mentionUnread={mentionUnreadByRoomId[channel.id] ?? 0}
        unreadBadgesReady={unreadBadgesReady}
        pinned={isRoomPinned(channel.id)}
        notificationsMuted={isRoomNotificationsMuted(channel.id)}
      />
    );
  }

  if (entry.kind === "group") {
    const group = entry.group;
    return (
      <SidebarNavItem
        active={target.kind === "group" && target.group.id === group.id}
        onClick={() => onTargetChange({ kind: "group", group })}
        avatar={
          <span
            className="flex size-9 shrink-0 items-center justify-center text-muted-foreground"
            aria-hidden
          >
            <Users className="size-4" />
          </span>
        }
        title={group.name}
        preview={roomPreviewsByRoomId[group.room_id]}
        roomId={group.room_id}
        contacts={contacts}
        previewOptions={{ ...previewOpts, isGroup: true }}
        unread={unreadByRoomId[group.room_id] ?? 0}
        mentionUnread={mentionUnreadByRoomId[group.room_id] ?? 0}
        unreadBadgesReady={unreadBadgesReady}
        pinned={isRoomPinned(group.room_id)}
        notificationsMuted={isRoomNotificationsMuted(group.room_id)}
      />
    );
  }

  const contact = entry.contact;
  const label = displayLabelForChatContact(contact, nicknamesByUserId);
  const dmRoomId = contact.dm_room_id ?? null;
  const online = Boolean(onlineUserIds[normalizeTypingUserId(contact.user_id)]);
  return (
    <SidebarNavItem
      active={target.kind === "dm" && target.contact.user_id === contact.user_id}
      onClick={() => onTargetChange({ kind: "dm", contact })}
      avatar={
        <ChatPresenceAvatar
          name={label}
          initials={initialOf(label)}
          size="sm"
          online={online}
        />
      }
      title={label}
      preview={dmRoomId ? roomPreviewsByRoomId[dmRoomId] : undefined}
      roomId={dmRoomId}
      contacts={contacts}
      previewOptions={{ ...previewOpts, isGroup: false }}
      unread={dmRoomId ? (unreadByRoomId[dmRoomId] ?? 0) : 0}
      mentionUnread={dmRoomId ? (mentionUnreadByRoomId[dmRoomId] ?? 0) : 0}
      unreadBadgesReady={unreadBadgesReady}
      pinned={isRoomPinned(dmRoomId)}
      notificationsMuted={isRoomNotificationsMuted(dmRoomId)}
    />
  );
}

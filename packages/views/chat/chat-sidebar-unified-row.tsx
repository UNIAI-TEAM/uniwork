"use client";

import { Hash, Home, Lock, Users } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ChatContact } from "@uniwork/core/chat/contacts-store";
import { displayLabelForChatContact } from "@uniwork/core/chat/contacts-store";
import { usePresenceStore } from "@uniwork/core/chat/presence-store";
import { normalizeTypingUserId } from "@uniwork/core/chat/typing-user-id";
import { initialOf } from "./chat-initials";
import { ChatPresenceAvatar } from "./chat-presence-avatar";
import { ChatRoomMark } from "./chat-room-mark";
import type { ChatRoomPreview } from "./chat-sidebar-preview";
import { SidebarNavItem } from "./chat-sidebar-rows";
import type { ChatSidebarTarget } from "./chat-sidebar-types";
import type { UnifiedSidebarEntry } from "./chat-sidebar-unified";


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
  const { t } = useTranslation();
  const workspaceSubtitle = t("chat.workspace_room_subtitle");
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
    const active = target.kind === "workspace";
    return (
      <SidebarNavItem
        active={active}
        onClick={() => onTargetChange({ kind: "workspace" })}
        avatar={<ChatRoomMark icon={Home} active={active} />}
        title={workspaceTitle}
        fallbackSubtitle={workspaceSubtitle}
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
    const active = target.kind === "channel" && target.channel.id === channel.id;
    return (
      <SidebarNavItem
        active={active}
        onClick={() => onTargetChange({ kind: "channel", channel })}
        avatar={
          <ChatRoomMark icon={privateChannel ? Lock : Hash} active={active} />
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
    const active = target.kind === "group" && target.group.id === group.id;
    return (
      <SidebarNavItem
        active={active}
        onClick={() => onTargetChange({ kind: "group", group })}
        avatar={
          <ChatRoomMark icon={Users} active={active} />
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
          size="lg"
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

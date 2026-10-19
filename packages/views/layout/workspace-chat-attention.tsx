"use client";

import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { ChatRoomRecord } from "@uniwork/core/api/endpoints/chat";
import { useChatRooms, useChatUnreadBadge } from "@uniwork/core/chat";
import { useActiveChatRoomStore } from "@uniwork/core/chat/active-chat-room-store";
import { useNotifications } from "@uniwork/core/notifications";
import { usePush } from "@uniwork/core/notifications/push";
import { paths } from "@uniwork/core/paths";
import { getWebNotificationPermission, showWebNotification, useHostFocus } from "@uniwork/core/platform";
import { useWorkspaces } from "@uniwork/core/workspaces";
import { formatChatSidebarPreviewText } from "../chat/chat-sidebar-preview";
import { notificationTitleKey } from "../notifications/notification-title";
import { resourceHref } from "../notifications/resource-href";
import { useWorkspace } from "./workspace-context";

const TITLE_COUNT = /^\(\d+\) /;
/** Kinds worth a banner over whatever the person is doing in another tab or window (H1). */
const BANNER_KINDS = new Set(["chat_dm", "chat_mentioned"]);

/** Prefixes the tab title with the count, and keeps it there when the router rewrites the title. */
function useTitleCount(count: number) {
  useEffect(() => {
    const apply = () => {
      const base = document.title.replace(TITLE_COUNT, "");
      const next = count > 0 ? `(${count}) ${base}` : base;
      if (document.title !== next) document.title = next;
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => {
      observer.disconnect();
      document.title = document.title.replace(TITLE_COUNT, "");
    };
  }, [count]);
}

const lastMessageAt = (room: ChatRoomRecord) => Date.parse(room.last_message_at ?? "") || 0;

/**
 * Chat reaching a person who is not looking at it: the unread count in the
 * tab title, and a browser banner (inside UniChat, a system one) per new
 * message, as Zalo and Telegram do. The banner needs permission already
 * granted (never prompted here) and stays off while this browser has Web
 * Push, which shows DMs and mentions itself.
 *
 * Rooms listed in this workspace (its channels, and every DM and group of the
 * organization) banner from the room list the realtime sync patches on each
 * new message: any sender but the person, in a room they did not mute, with
 * the list line as the body, unless the app is focused on that very room.
 * Rooms of other workspaces banner from the unread notifications refetched on
 * notification.created, the one user-scope event that crosses workspaces:
 * a DM or mention only, title only, while the app is not focused (focused,
 * WorkspaceChatToast shows them).
 */
export function WorkspaceChatAttention() {
  const { t } = useTranslation();
  const { workspace, user } = useWorkspace();
  const workspaceList = useWorkspaces();
  const workspaces = workspaceList.data;
  const workspacesLoading = workspaceList.isPending;
  const rooms = useChatRooms(workspace.id).data;
  useTitleCount(useChatUnreadBadge(workspace.id));

  const focused = useHostFocus();
  const activeRoomId = useActiveChatRoomStore((s) => (s.workspaceId === workspace.id ? s.roomId : null));
  const push = usePush();
  const banners = getWebNotificationPermission() === "granted" && !push.subscribed;

  /** Newest `last_message_at` seen in the room list; null before its first load. */
  const newestMessageSeen = useRef<number | null>(null);
  useEffect(() => {
    if (!rooms) return;
    const before = newestMessageSeen.current;
    newestMessageSeen.current = Math.max(before ?? -Infinity, ...rooms.map(lastMessageAt));
    // The first load is the backlog, not news.
    if (before === null || !banners) return;
    const me = user.id.toUpperCase();
    for (const room of rooms) {
      if (lastMessageAt(room) <= before || room.notifications_muted) continue;
      if ((room.last_message_sender_id ?? "").toUpperCase() === me) continue;
      if (focused && room.id === activeRoomId) continue;
      const sender = room.last_message_sender_name ?? "";
      const isGroup = room.kind !== "dm";
      const body = formatChatSidebarPreviewText(
        {
          body: room.last_message_body ?? "",
          kind: room.last_message_kind ?? "text",
          senderId: room.last_message_sender_id ?? "",
          senderName: sender,
          createdAt: room.last_message_at ?? "",
          callOutcome: room.last_message_call_outcome,
          durationMs: room.last_message_duration_ms,
        },
        {
          currentUserId: user.id,
          isGroup,
          youLabel: t("chat.you"),
          voiceCallLabel: t("chat.sidebar_voice_call_preview"),
          voiceMessageLabel: t("chat.sidebar_voice_message_preview"),
          missedCallLabel: t("chat.voice_call_log_missed"),
          fileMessageLabel: t("chat.sidebar_file_message_preview"),
          mediaLabels: { sticker: t("chat.media_sticker"), gif: t("chat.media_gif"), image: t("chat.sidebar_photo_preview") },
        },
      );
      // One banner per message, so a burst stacks like a messenger's instead of replacing the last.
      showWebNotification({
        slug: workspace.slug,
        itemId: `${room.id}:${room.last_message_at ?? ""}`,
        issueKey: room.id,
        href: paths.workspace(workspace.organization_slug, workspace.slug).chatConversation(room.id),
        title: isGroup ? room.name : sender || room.name,
        body: body ?? "",
      });
    }
  }, [activeRoomId, banners, focused, rooms, t, user.id, workspace]);

  const recent = useNotifications({ unreadOnly: true, limit: 20, enabled: banners });
  /** Newest `updated_at ?? created_at` seen so far; null before the first load. */
  const newestSeen = useRef<number | null>(null);
  useEffect(() => {
    const rows = recent.data?.notifications;
    // The link of a banner is fixed when it shows, so it waits for the list of
    // workspaces it is looked up in; a failed list falls back to the open one.
    // It also waits for the room list, which says what the room path covers.
    if (!rows || workspacesLoading || !rooms) return;
    const stamp = (n: (typeof rows)[number]) => Date.parse(n.updated_at ?? n.created_at) || 0;
    const before = newestSeen.current;
    newestSeen.current = Math.max(before ?? -Infinity, ...rows.map(stamp));
    // The first load is the backlog, not news; a focused app has the inbox.
    if (before === null || focused) return;
    for (const n of rows) {
      // Only what is newer than anything seen: an old row the top-20 window
      // pulls in once newer ones are read is not news (UNI-1074).
      if (!BANNER_KINDS.has(n.kind) || stamp(n) <= before) continue;
      // A room listed here already bannered from the room list.
      if (rooms.some((room) => room.id === n.resource_parent_id)) continue;
      // The id is the tag: a merged row replaces its earlier banner.
      showWebNotification({
        slug: workspace.slug,
        itemId: n.id,
        issueKey: n.id,
        href: resourceHref(n, workspace, workspaces ?? []),
        title: t(notificationTitleKey(n), n.params),
        body: "",
      });
    }
  }, [focused, recent.data, rooms, t, workspace, workspaces, workspacesLoading]);
  return null;
}

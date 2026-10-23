// What the inbox does to one of its rooms, in one place for the three ways in:
// the long-press menu (an ActionSheet), the row's swipe (room-swipe.tsx) and
// the row's screen-reader actions (room-row.tsx). Mark read clears the badge
// at once and queues the read (data/pending-ops.ts); pin is the device's own
// list (data/stores/chat-pins-store.ts); mute is optimistic on the list and
// says so when the server refuses it.
import type { TFunction } from "i18next";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { SheetAction } from "@/components/ui/action-sheet";
import { useMarkRoomRead } from "@/data/mutations/messages";
import { useSetRoomMuted } from "@/data/mutations/rooms";
import { useChatPinsStore } from "@/data/stores/chat-pins-store";
import { toast } from "@/data/stores/toast-store";
import type { RoomListRow } from "@/lib/room-list";
import type { ChatWorkspace } from "./use-chat-workspace";

export interface RoomCommands {
  markRead: (row: RoomListRow) => void;
  togglePin: (row: RoomListRow) => void;
  toggleMute: (row: RoomListRow) => void;
}

/** A row's commands that apply now: read only with something unread, mute only for a room that exists. */
export function roomCommandsFor(row: RoomListRow): { read: boolean; pin: boolean; mute: boolean } {
  const exists = Boolean(row.roomId && row.room);
  return { read: exists && (row.unread > 0 || row.mentionUnread > 0), pin: Boolean(row.roomId), mute: exists };
}

export function useRoomCommands(chat: ChatWorkspace | null): RoomCommands {
  const { t } = useTranslation();
  const wsId = chat?.wsId ?? "";
  const userId = chat?.userId ?? "";
  const setRoomMuted = useSetRoomMuted(wsId).mutateAsync;
  const markRoomRead = useMarkRoomRead();
  return useMemo(
    () => ({
      markRead: (row: RoomListRow) => {
        if (wsId && row.roomId) markRoomRead(wsId, row.roomId, userId);
      },
      togglePin: (row: RoomListRow) => {
        if (row.roomId) void useChatPinsStore.getState().toggle(row.roomId);
      },
      toggleMute: (row: RoomListRow) => {
        if (row.roomId && row.room) void setRoomMuted({ roomId: row.roomId, muted: !row.muted }).catch(() => toast.error(t("common.error")));
      },
    }),
    [wsId, userId, markRoomRead, setRoomMuted, t],
  );
}

/** The long-press menu's rows for a room: mark read when there is something unread, then pin and mute. */
export function roomMenuActions(row: RoomListRow | null, commands: RoomCommands, t: TFunction): SheetAction[] {
  if (!row) return [];
  const can = roomCommandsFor(row);
  const actions: SheetAction[] = [];
  if (can.read)
    actions.push({
      key: "read",
      label: t("mobile.notification_actions.mark_read"),
      icon: "checkmark-done-outline",
      onPress: () => commands.markRead(row),
    });
  if (can.pin)
    actions.push({
      key: "pin",
      label: row.pinned ? t("chat.mobile.unpin_conversation") : t("chat.settings_pin_conversation"),
      icon: row.pinned ? "pin" : "pin-outline",
      onPress: () => commands.togglePin(row),
    });
  if (can.mute)
    actions.push({
      key: "mute",
      label: row.muted ? t("chat.mobile.unmute_notifications") : t("chat.settings_mute_notifications"),
      icon: row.muted ? "notifications-outline" : "notifications-off-outline",
      onPress: () => commands.toggleMute(row),
    });
  return actions;
}

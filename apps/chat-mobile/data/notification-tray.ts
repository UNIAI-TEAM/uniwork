// The notification tray follows what was read: once a room is read — here or on another of the
// person's devices while this one holds its socket (data/room-read-signal.ts) —
// its message notifications come down, as Slack, WhatsApp and Telegram do. A
// thread reply's notification stays (the thread is read in the thread, and the
// server keeps its row open too), and so does anything that is not a chat
// message (a ringing call, a task). A phone that was closed while another
// device read the room clears it the next time the room is read here.
import * as Notifications from "expo-notifications";
import { chatPushTarget } from "@/lib/chat-notification";

/** Dismisses the room's presented message notifications; resolves how many went. */
export async function dismissRoomNotifications(roomId: string): Promise<number> {
  const presented = await Notifications.getPresentedNotificationsAsync();
  const ids = presented
    .filter((notification) => {
      const target = chatPushTarget(notification.request.content.data);
      return target?.roomId === roomId && !target.threadRootId;
    })
    .map((notification) => notification.request.identifier);
  await Promise.all(ids.map((id) => Notifications.dismissNotificationAsync(id)));
  return ids.length;
}

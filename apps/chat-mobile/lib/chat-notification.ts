// A chat message push's actions: the server files every DM, mention and thread
// reply push under the "chat_message" category (server
// notification/push_expo.go › ChatMessageCategory) with the ids those
// actions need; the app registers the category with Reply (a text field) and
// Mark as read, as WhatsApp, Telegram and Slack do. This reads a notification
// response — from the listener of a running app or Android's background task
// — into the action to run. Every value is read leniently: an unknown action,
// a missing id or an empty reply is not one. Pure.
import { CHAT_MESSAGE_BODY_MAX_LENGTH } from "@uniwork/core/chat/client-msg-id";
import { asRecord } from "./unknown-shape";

export const CHAT_MESSAGE_CATEGORY = "chat_message";
export const REPLY_ACTION = "reply";
export const MARK_READ_ACTION = "mark_read";

export interface ChatPushTarget {
  workspaceId: string;
  roomId: string;
  messageId: string;
  /** Set on a thread reply's push: a reply from the notification goes into that thread. */
  threadRootId?: string;
}

/** A notification as it was shown: its title and the push's data. */
interface ShownChatPush {
  title: string;
  data: Record<string, unknown>;
}

export type ChatNotificationAction =
  /** `shown` lets a reply the app lock refuses put the notification back (data/chat-notification-actions.ts). */
  | { action: "reply"; key: string; notificationId: string; target: ChatPushTarget; text: string; shown: ShownChatPush }
  | { action: "mark_read"; key: string; notificationId: string; target: ChatPushTarget };

const record = asRecord;

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** A push's data as the platform hands it: the object, or Android's `dataString` JSON in its place. */
function pushData(value: unknown): Record<string, unknown> | null {
  const data = record(value);
  if (!data || typeof data.dataString !== "string") return data;
  try {
    return record(JSON.parse(data.dataString));
  } catch {
    return null;
  }
}

/** The room a chat push is about, or null when the push is not one (a call, a task, an older server). */
export function chatPushTarget(value: unknown): ChatPushTarget | null {
  const data = pushData(value);
  if (!data) return null;
  const workspaceId = text(data.workspace_id);
  const roomId = text(data.room_id);
  const messageId = text(data.message_id);
  if (!workspaceId || !roomId || !messageId || data.call_id !== undefined) return null;
  const threadRootId = text(data.thread_root_id);
  return threadRootId ? { workspaceId, roomId, messageId, threadRootId } : { workspaceId, roomId, messageId };
}

/**
 * A chat message that follows one its room alerted for within the server's window (server push_consumer.go ›
 * chatAlertWindow): it shows without a sound, in the foreground as on the lock screen.
 */
export function isQuietPush(value: unknown): boolean {
  return pushData(value)?.quiet === "1";
}

/** The Reply or Mark as read a notification response asks for, or null (a plain tap opens the room as before). */
export function chatNotificationAction(response: unknown): ChatNotificationAction | null {
  const outer = record(response);
  const action = text(outer?.actionIdentifier);
  if (action !== REPLY_ACTION && action !== MARK_READ_ACTION) return null;
  const request = record(record(outer?.notification)?.request);
  const notificationId = text(request?.identifier);
  // A listener gets the push's data parsed into `content.data` (expo-notifications' mapNotificationResponse);
  // Android's background task gets the native bundle as is: for a push of Expo's service, the data is a JSON
  // string at `content.dataString` and there is no `data` (NotificationSerializer.toBundle(NotificationRequest)).
  const content = record(request?.content);
  const data = pushData(content?.data ?? (typeof content?.dataString === "string" ? { dataString: content.dataString } : null));
  const target = chatPushTarget(data);
  if (!data || !target) return null;
  // One action of one push runs once, whichever of the listener and the background task hears it first. Android
  // shows every push of a room under one notification id (the room's tag; each message pushes, server UNI-2141),
  // so the message names which push it was.
  const key = `${notificationId}:${target.messageId}:${action}`;
  if (action === MARK_READ_ACTION) return { action, key, notificationId, target };
  const reply = text(outer?.userText).trim().slice(0, CHAT_MESSAGE_BODY_MAX_LENGTH);
  return reply ? { action, key, notificationId, target, text: reply, shown: { title: text(content?.title), data } } : null;
}

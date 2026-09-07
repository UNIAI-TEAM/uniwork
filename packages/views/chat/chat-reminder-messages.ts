import type { RoomReminder } from "@uniwork/core/chat/room-bulletin-store";
import { reminderBodyLabel } from "@uniwork/core/chat/reminder-utils";
import type { ChatMessage } from "./chat-messages";

export function bulletinRemindersToChatMessages(
  reminders: RoomReminder[],
  currentUserId: string,
): ChatMessage[] {
  return reminders.map((entry) => ({
    id: entry.id,
    sender: entry.createdBy ?? currentUserId,
    body: reminderBodyLabel(entry),
    kind: "reminder",
    ts: Date.parse(entry.createdAt),
    reactions: {},
    reminder: {
      body: reminderBodyLabel(entry),
      remindAt: entry.remindAt,
      repeat: entry.repeat ?? "none",
    },
  }));
}

export function mergeChatMessagesWithReminders(
  messages: ChatMessage[],
  reminders: RoomReminder[],
  currentUserId: string,
): ChatMessage[] {
  if (reminders.length === 0) return messages;
  const virtual = bulletinRemindersToChatMessages(reminders, currentUserId);
  const seen = new Set(messages.map((message) => message.id));
  const merged = [...messages];
  for (const message of virtual) {
    if (seen.has(message.id)) continue;
    merged.push(message);
  }
  return merged.sort((a, b) => a.ts - b.ts);
}

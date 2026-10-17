// The chat tab's one-shot commands and what each does to the cache, mirroring
// the mutations of packages/core/chat/{chat-hooks-rooms,chat-hooks-messages,
// thread-hooks,chat-follow-up-hooks,chat-link-hooks}.ts. Screens await them; a
// rejection is the screen's to show.
import type { QueryClient } from "@tanstack/react-query";
import type { ChatRoomRecord } from "@uniwork/core/api/endpoints/chat-schemas";
import { newChatClientMsgId } from "@uniwork/core/chat/client-msg-id";
import type { ReminderRepeat } from "@uniwork/core/chat/reminder-utils";
import { applyChatMessageResponse, patchChatMessageDeleted } from "./chat-cache";
import { chatApi, type ChatTask } from "./chat-api";
import { chatKeys } from "./queries/chat-keys";

function clearUnread(qc: QueryClient, wsId: string, roomId: string): void {
  qc.setQueryData<ChatRoomRecord[]>(chatKeys.rooms(wsId), (old) =>
    old?.map((room) => (room.id === roomId ? { ...room, unread_count: 0, mention_unread_count: 0 } : room)),
  );
}

/** Opening a room, reaching its newest message, or leaving it: the badge clears now, the server follows. */
export async function markRoomRead(qc: QueryClient, wsId: string, roomId: string): Promise<void> {
  clearUnread(qc, wsId, roomId);
  if (await chatApi.markRoomRead(wsId, roomId)) clearUnread(qc, wsId, roomId);
}

/** The read pointer of a thread; the server hands back the one it replaced. */
export function markThreadRead(wsId: string, rootId: string): Promise<string | null> {
  return chatApi.markThreadRead(wsId, rootId);
}

/** Optimistic: the flag moves only this person's row, and a failure restores it. */
export async function setRoomMuted(qc: QueryClient, wsId: string, roomId: string, muted: boolean): Promise<void> {
  const key = chatKeys.rooms(wsId);
  await qc.cancelQueries({ queryKey: key });
  const previous = qc.getQueryData<ChatRoomRecord[]>(key);
  qc.setQueryData<ChatRoomRecord[]>(key, (old) =>
    old?.map((room) => (room.id === roomId ? { ...room, notifications_muted: muted } : room)),
  );
  const ok = await chatApi.setRoomMuted(wsId, roomId, muted).catch(() => false);
  if (!ok) {
    qc.setQueryData(key, previous);
    throw new Error("chat_room_mute_failed");
  }
}

export async function toggleReaction(qc: QueryClient, wsId: string, roomId: string, messageId: string, emoji: string): Promise<void> {
  applyChatMessageResponse(qc, wsId, roomId, await chatApi.toggleReaction(wsId, roomId, messageId, emoji), false);
}

export async function editMessage(qc: QueryClient, wsId: string, roomId: string, messageId: string, body: string): Promise<void> {
  applyChatMessageResponse(qc, wsId, roomId, await chatApi.editMessage(wsId, roomId, messageId, body), false);
  void qc.invalidateQueries({ queryKey: chatKeys.rooms(wsId) });
}

export async function deleteMessage(qc: QueryClient, wsId: string, roomId: string, messageId: string): Promise<void> {
  if (!(await chatApi.deleteMessage(wsId, roomId, messageId))) throw new Error("chat_message_delete_failed");
  patchChatMessageDeleted(qc, wsId, roomId, messageId);
  void qc.invalidateQueries({ queryKey: chatKeys.rooms(wsId) });
}

/** A signed media URL past its expiry: load the message again; its fresh URLs flow back through the cache. */
export async function refreshMessageMedia(qc: QueryClient, wsId: string, roomId: string, messageId: string) {
  const fresh = await chatApi.getMessage(wsId, roomId, messageId);
  if (fresh) applyChatMessageResponse(qc, wsId, roomId, fresh, false);
  return fresh;
}

/** The DM with a person, created on first use; null when the server answers none. */
export async function resolveDMRoom(qc: QueryClient, wsId: string, userId: string): Promise<ChatRoomRecord | null> {
  const room = await chatApi.resolveDMRoom(wsId, userId);
  void qc.invalidateQueries({ queryKey: chatKeys.rooms(wsId) });
  return room;
}

export async function joinChannel(qc: QueryClient, wsId: string, roomId: string): Promise<ChatRoomRecord | null> {
  const room = await chatApi.joinChannel(wsId, roomId);
  await qc.invalidateQueries({ queryKey: chatKeys.rooms(wsId) });
  void qc.invalidateQueries({ queryKey: chatKeys.discoverableChannels(wsId) });
  return room;
}

// M3: the rich kinds.

export async function votePoll(qc: QueryClient, wsId: string, roomId: string, messageId: string, optionId: string): Promise<void> {
  applyChatMessageResponse(qc, wsId, roomId, await chatApi.votePoll(wsId, roomId, messageId, optionId), false);
}

/** The server's bounds on a clip (chat_voice_message.go): 1 ms to 2 minutes. */
const MAX_VOICE_MS = 120_000;

/** A recorded clip: it lands in the timeline like a sent message; nothing back is a failure to show. */
export async function sendVoiceMessage(
  qc: QueryClient,
  wsId: string,
  roomId: string,
  input: { uri: string; durationMs: number; replyToMessageId?: string },
): Promise<void> {
  const message = await chatApi.sendVoiceMessage(wsId, roomId, {
    uri: input.uri,
    duration_ms: Math.min(MAX_VOICE_MS, Math.max(1, Math.round(input.durationMs))),
    client_msg_id: newChatClientMsgId(),
    reply_to_message_id: input.replyToMessageId,
  });
  if (!message) throw new Error("chat_voice_send_failed");
  applyChatMessageResponse(qc, wsId, roomId, message, true);
  void qc.invalidateQueries({ queryKey: chatKeys.rooms(wsId) });
}

/** A reminder message, as chat-create-reminder-dialog.tsx sends it: no body, the reminder beside it. */
export async function sendReminder(
  qc: QueryClient,
  wsId: string,
  roomId: string,
  input: { body: string; remindAt: Date; repeat: ReminderRepeat },
): Promise<void> {
  const message = await chatApi.sendMessage(wsId, roomId, {
    client_msg_id: newChatClientMsgId(),
    reminder: { body: input.body.trim(), remind_at: input.remindAt.toISOString(), repeat: input.repeat },
  });
  if (!message) throw new Error("chat_reminder_send_failed");
  applyChatMessageResponse(qc, wsId, roomId, message, true);
  void qc.invalidateQueries({ queryKey: chatKeys.rooms(wsId) });
}

const FOLLOW_UP_COMMANDS = {
  create: (wsId: string, id: string) => chatApi.createFollowUp(wsId, id),
  complete: (wsId: string, id: string) => chatApi.patchFollowUp(wsId, id, { completed: true }),
  remove: (wsId: string, id: string) => chatApi.deleteFollowUp(wsId, id),
};

/**
 * Follows a message up later (`create`, with the message id), or completes or
 * drops a follow-up (with its id); each refetches the list, and a null or
 * false answer changed nothing and is a failure to show.
 */
export async function followUpCommand(qc: QueryClient, wsId: string, command: keyof typeof FOLLOW_UP_COMMANDS, id: string): Promise<void> {
  if (!(await FOLLOW_UP_COMMANDS[command](wsId, id))) throw new Error("chat_follow_up_failed");
  void qc.invalidateQueries({ queryKey: chatKeys.followUps(wsId) });
}

/**
 * A task from a message, straight or through its follow-up: the task card
 * under the message shows once the room's links refetch.
 */
export async function createTaskFromMessage(
  qc: QueryClient,
  wsId: string,
  roomId: string,
  from: { messageId: string; title?: string } | { followUpId: string },
): Promise<ChatTask> {
  const task =
    "followUpId" in from ? await chatApi.convertFollowUpToTask(wsId, from.followUpId) : await chatApi.createTaskFromMessage(wsId, from.messageId, { title: from.title });
  void qc.invalidateQueries({ queryKey: chatKeys.roomLinksRoot(wsId, roomId) });
  if ("followUpId" in from) void qc.invalidateQueries({ queryKey: chatKeys.followUps(wsId) });
  if (!task) throw new Error("chat_task_create_failed");
  return task;
}

export async function leaveRoom(qc: QueryClient, wsId: string, roomId: string): Promise<void> {
  if (!(await chatApi.leaveRoom(wsId, roomId))) throw new Error("chat_room_leave_failed");
  qc.setQueryData<ChatRoomRecord[]>(chatKeys.rooms(wsId), (old) => old?.filter((room) => room.id !== roomId));
  qc.removeQueries({ queryKey: chatKeys.roomMessages(wsId, roomId) });
  void qc.invalidateQueries({ queryKey: chatKeys.rooms(wsId) });
  void qc.invalidateQueries({ queryKey: chatKeys.discoverableChannels(wsId) });
}

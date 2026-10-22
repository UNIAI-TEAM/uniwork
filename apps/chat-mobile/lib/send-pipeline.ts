// The phone's pending sends and how they show on a timeline. The web keeps two
// lists (pending sends and a persisted outbox); the phone keeps one persisted
// list (data/stores/chat-send-store.ts) whose entries carry their own status,
// so it has its own row shape. Joining those rows to the server's timeline is
// core's (@uniwork/core/chat/optimistic-merge), and so is when a send is worth
// repeating (@uniwork/core/chat/send-retry), both shared with the web.
import { mergeOptimisticMessages, type ServerLikeChatMessage } from "@uniwork/core/chat/optimistic-merge";
import { pendingChatMessageId } from "@uniwork/core/chat/pending-message-id";
import type { ReminderRepeat } from "@uniwork/core/chat/reminder-utils";

export type SendStatus = "sending" | "queued" | "failed";

/** A local attachment from the image or document picker. */
export interface PendingFile {
  uri: string;
  name: string;
  mimeType?: string;
  size?: number;
}

/** One message this device is sending, until the server's copy lands. */
export interface PendingSend {
  workspaceId: string;
  roomId: string;
  senderId: string;
  clientMsgId: string;
  body: string;
  replyToMessageId?: string;
  /** Set for a thread reply; it then belongs to the thread, not the room. */
  threadRootId?: string;
  /** A photo or document, or the clip of a voice message; in the outbox directory once queued (data/outbox-files.ts). */
  file?: PendingFile;
  /** Set for a voice message: `file` is the recorded clip, this its length. */
  voiceDurationMs?: number;
  /** Set for a reminder message: no body, the reminder beside it (chat-create-reminder-dialog.tsx). */
  reminder?: { body: string; remindAt: string; repeat: ReminderRepeat };
  createdAt: number;
  status: SendStatus;
}

/** What the merge needs from a server message (lib/timeline-display.ts › TimelineMessage). */
export interface ServerLikeMessage extends ServerLikeChatMessage {
  body: string;
}

export interface OptimisticChatMessage extends ServerLikeMessage {
  clientMsgId: string;
  threadRootId?: string;
  replyToEventId?: string;
  pending: PendingSend;
}

export function pendingToOptimisticChatMessage(entry: PendingSend): OptimisticChatMessage {
  return {
    id: pendingChatMessageId(entry.clientMsgId),
    clientMsgId: entry.clientMsgId,
    sender: entry.senderId,
    body: entry.body,
    ts: entry.createdAt,
    replyToEventId: entry.replyToMessageId,
    threadRootId: entry.threadRootId,
    pending: entry,
  };
}

/** The server's messages and this device's sends it has not echoed yet, oldest first. */
export function mergeOptimisticChatMessages<T extends ServerLikeMessage>(
  serverMessages: T[],
  pending: readonly PendingSend[],
  currentUserId: string,
): Array<T | OptimisticChatMessage> {
  return mergeOptimisticMessages(serverMessages, pending.map(pendingToOptimisticChatMessage), currentUserId);
}

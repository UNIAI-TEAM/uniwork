// The send side of a conversation, copied from packages/core/chat/
// {merge-optimistic-chat-messages,send-retry}.ts (both reach the web transport
// or zustand, so neither is on the mobile allowlist). The web keeps two lists
// (pending sends and a persisted outbox); the phone keeps one in-session list
// whose entries carry their own status. send-pipeline.test.ts runs the web
// tests' cases on that shape.
import { pendingChatMessageId } from "@uniwork/core/chat/pending-message-id";

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
  file?: PendingFile;
  createdAt: number;
  status: SendStatus;
}

/** What the merge needs from a server message (lib/timeline-display.ts › TimelineMessage). */
export interface ServerLikeMessage {
  id: string;
  sender: string;
  body: string;
  ts: number;
  /** Echo of the sender's idempotency key; absent on messages sent elsewhere. */
  clientMsgId?: string;
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

/**
 * The server echoes the idempotency key, so the local copy disappears on an
 * exact match — never on body and a time window, which left a duplicate
 * bubble forever whenever the clock drifted.
 */
export function shouldHideOptimisticMessage(
  optimistic: OptimisticChatMessage,
  serverMessages: readonly ServerLikeMessage[],
  currentUserId: string,
): boolean {
  if (optimistic.sender !== currentUserId) return false;
  return serverMessages.some((message) => message.clientMsgId === optimistic.clientMsgId);
}

export function mergeOptimisticChatMessages<T extends ServerLikeMessage>(
  serverMessages: T[],
  pending: readonly PendingSend[],
  currentUserId: string,
): Array<T | OptimisticChatMessage> {
  const visible = pending
    .map(pendingToOptimisticChatMessage)
    .filter((message) => !shouldHideOptimisticMessage(message, serverMessages, currentUserId));
  return [...serverMessages, ...visible].sort((left, right) => left.ts - right.ts);
}

export const CHAT_SEND_MAX_ATTEMPTS = 3;
export const CHAT_SEND_RETRY_DELAYS_MS = [400, 1_200] as const;
/** A Retry-After longer than this is handed back: the sender should not watch a spinner. */
const CHAT_SEND_MAX_RETRY_AFTER_MS = 5_000;

/** The slice of data/api.ts › ApiError the policy reads; status 0 is the client's own timeout. */
type StatusError = { status: number; retryAfterSeconds?: number };

function statusOf(err: unknown): StatusError | null {
  if (typeof err !== "object" || err === null || !("status" in err)) return null;
  return typeof err.status === "number" ? (err as StatusError) : null;
}

/** True when repeating the same client_msg_id send may succeed later. */
export function isRetriableChatSendError(err: unknown): boolean {
  // fetch rejects with a TypeError when there is no network at all.
  if (err instanceof TypeError) return true;
  const status = statusOf(err)?.status;
  if (status === undefined) return false;
  return status === 0 || status === 408 || status === 429 || status >= 500;
}

/** True when the server refused this message for good (403, 404, 410, 422…); 401 is the session. */
export function isPermanentChatSendRefusal(err: unknown): boolean {
  const status = statusOf(err)?.status;
  return status !== undefined && status >= 400 && status < 500 && status !== 401 && !isRetriableChatSendError(err);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runWithChatSendRetry<T>(
  fn: () => Promise<T>,
  options?: { maxAttempts?: number; delaysMs?: readonly number[] },
): Promise<T> {
  const maxAttempts = options?.maxAttempts ?? CHAT_SEND_MAX_ATTEMPTS;
  const delaysMs = options?.delaysMs ?? CHAT_SEND_RETRY_DELAYS_MS;
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      const serverWait = (statusOf(err)?.retryAfterSeconds ?? 0) * 1_000;
      if (attempt >= maxAttempts - 1 || !isRetriableChatSendError(err) || serverWait > CHAT_SEND_MAX_RETRY_AFTER_MS) {
        throw err;
      }
      const delay = delaysMs[Math.min(attempt, delaysMs.length - 1)] ?? 400;
      await sleep(Math.max(delay, serverWait));
    }
  }
}

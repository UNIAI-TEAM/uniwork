// How a host's local copies of the messages it is sending join the server's
// timeline, shared by the web and the phone (apps/chat-mobile, ADR 0011: on
// its core allowlist). Each host keeps its own pending list and turns each
// entry into its own optimistic row (merge-optimistic-chat-messages.ts on the
// web, lib/send-pipeline.ts on the phone); this module only needs the slice
// both rows share, so it imports no store.

/** What the merge reads from a server message. */
export interface ServerLikeChatMessage {
  id: string;
  sender: string;
  ts: number;
  /** Echo of the sender's idempotency key; absent on messages sent elsewhere. */
  clientMsgId?: string;
}

/** What the merge reads from a host's optimistic row. */
export interface OptimisticLikeChatMessage {
  sender: string;
  ts: number;
  clientMsgId: string;
}

/**
 * The server echoes the idempotency key, so the local copy disappears on an
 * exact match. Matching on body and a timestamp window instead left a
 * duplicate bubble on screen forever whenever the device clock drifted from
 * the server or the queued entry outlived the window.
 */
export function shouldHideOptimisticMessage(
  optimistic: OptimisticLikeChatMessage,
  serverMessages: readonly ServerLikeChatMessage[],
  currentUserId: string,
): boolean {
  if (optimistic.sender !== currentUserId) return false;
  return serverMessages.some((message) => message.clientMsgId === optimistic.clientMsgId);
}

/** The server's messages and the optimistic rows it has not echoed yet, oldest first. */
export function mergeOptimisticMessages<T extends ServerLikeChatMessage, O extends OptimisticLikeChatMessage>(
  serverMessages: T[],
  optimistic: readonly O[],
  currentUserId: string,
): Array<T | O> {
  const visible = optimistic.filter((message) => !shouldHideOptimisticMessage(message, serverMessages, currentUserId));
  return [...serverMessages, ...visible].sort((left, right) => left.ts - right.ts);
}

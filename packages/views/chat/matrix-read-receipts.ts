import type { Room } from "matrix-js-sdk";
import { isServerMatrixEventId } from "./matrix-unread";
import type { ChatMessage } from "./chat-messages";

/** Event id of the last own message the reader has read (DM read-receipt tick). */
export function ownMessageIdWithReadReceipt(
  room: Room,
  messages: ChatMessage[],
  myMatrixUserId: string,
  readerMatrixUserId: string | null | undefined,
): string | null {
  if (!readerMatrixUserId || readerMatrixUserId === myMatrixUserId) return null;

  const readUpToId = room.getEventReadUpTo(readerMatrixUserId);
  if (!readUpToId || !isServerMatrixEventId(readUpToId)) return null;

  const readEvent = room.findEventById(readUpToId);
  if (!readEvent) return null;
  const readTs = readEvent.getTs();

  let markerId: string | null = null;
  for (const message of messages) {
    if (message.sender !== myMatrixUserId) continue;
    if (!isServerMatrixEventId(message.id)) continue;
    if (message.ts <= readTs) {
      markerId = message.id;
    }
  }
  return markerId;
}

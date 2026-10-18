/** True when the peer's read cursor has reached or passed this message time. */
export function isMessageSeenByPeer(
  messageTs: number,
  peerLastReadAt: string | null | undefined,
): boolean {
  if (!peerLastReadAt) return false;
  const peer = Date.parse(peerLastReadAt);
  if (Number.isNaN(peer)) return false;
  return messageTs <= peer;
}

type OwnMessageRef = { sender: string; ts: number };

/**
 * Show a read receipt only on the latest own message the peer has seen
 * (Messenger-style single "Seen" marker).
 */
export function shouldShowReadReceipt(input: {
  messages: OwnMessageRef[];
  index: number;
  currentUserId: string;
  peerLastReadAt: string | null | undefined;
}): boolean {
  const { messages, index, currentUserId, peerLastReadAt } = input;
  const message = messages[index];
  if (!message || message.sender !== currentUserId) return false;
  if (!isMessageSeenByPeer(message.ts, peerLastReadAt)) return false;
  for (let i = messages.length - 1; i > index; i--) {
    const later = messages[i];
    if (
      later &&
      later.sender === currentUserId &&
      isMessageSeenByPeer(later.ts, peerLastReadAt)
    ) {
      return false;
    }
  }
  return true;
}

/**
 * The index of the one own message that carries the read receipt (the latest
 * own message the peer has seen), or -1. One pass over the timeline instead
 * of `shouldShowReadReceipt` per row, which scanned to the end each time.
 */
export function latestSeenOwnMessageIndex(
  messages: OwnMessageRef[],
  currentUserId: string,
  peerLastReadAt: string | null | undefined,
): number {
  if (!peerLastReadAt) return -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message && message.sender === currentUserId && isMessageSeenByPeer(message.ts, peerLastReadAt)) {
      return i;
    }
  }
  return -1;
}

type ReadPointer = { user_id: string; last_read_at?: string | null };

/**
 * The members of a group or channel whose read cursor has reached this
 * message ("N người đã xem"), the sender excluded. Same comparison as a DM's
 * receipt: an unparsable time counts as not seen.
 * shortcut: created_at arrives in whole seconds, so a cursor on an earlier
 * message of the same second counts as seen; compare at the cursor's
 * microseconds if that ever shows.
 */
export function seenByMembers<M extends ReadPointer>(
  message: { created_at: string },
  members: readonly M[],
  senderId: string,
): M[] {
  const ts = Date.parse(message.created_at);
  return members.filter((m) => m.user_id !== senderId && isMessageSeenByPeer(ts, m.last_read_at));
}

export function seenByCount(
  message: { created_at: string },
  members: readonly ReadPointer[],
  senderId: string,
): number {
  return seenByMembers(message, members, senderId).length;
}

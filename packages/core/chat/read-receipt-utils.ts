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

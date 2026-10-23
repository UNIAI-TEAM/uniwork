// Copied from packages/views/chat/sender-colors.ts (senderColorIndex), so a
// sender's name has the same colour on the phone as on the web. Class names
// are spelled out for NativeWind; the slots are the chat-sender-* tokens.
const SENDER_NAME_CLASSES = [
  "text-chat-sender-1",
  "text-chat-sender-2",
  "text-chat-sender-3",
  "text-chat-sender-4",
  "text-chat-sender-5",
  "text-chat-sender-6",
  "text-chat-sender-7",
  "text-chat-sender-8",
] as const;

/** Stable hash → one of eight sender colours; the same function as the web's. */
export function senderColorIndex(userId: string): number {
  const key = userId.trim().toLowerCase();
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  return hash % SENDER_NAME_CLASSES.length;
}

export function senderNameClass(userId: string): string {
  return SENDER_NAME_CLASSES[senderColorIndex(userId)] ?? SENDER_NAME_CLASSES[0];
}

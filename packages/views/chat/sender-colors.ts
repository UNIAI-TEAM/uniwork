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

/** Stable hash → one of eight semantic sender colours (see tokens.css). */
export function senderColorIndex(matrixUserId: string): number {
  const key = matrixUserId.trim().toLowerCase();
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  return hash % SENDER_NAME_CLASSES.length;
}

export function senderNameClass(matrixUserId: string, isOwn: boolean): string {
  if (isOwn) return "text-brand";
  return SENDER_NAME_CLASSES[senderColorIndex(matrixUserId)] ?? SENDER_NAME_CLASSES[0];
}

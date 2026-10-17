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

/** A reply quote's side bar and wash, in the quoted sender's colour (same slot as the name). */
const SENDER_QUOTE_CLASSES = [
  "border-chat-sender-1 bg-chat-sender-1/8",
  "border-chat-sender-2 bg-chat-sender-2/8",
  "border-chat-sender-3 bg-chat-sender-3/8",
  "border-chat-sender-4 bg-chat-sender-4/8",
  "border-chat-sender-5 bg-chat-sender-5/8",
  "border-chat-sender-6 bg-chat-sender-6/8",
  "border-chat-sender-7 bg-chat-sender-7/8",
  "border-chat-sender-8 bg-chat-sender-8/8",
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

export function senderQuoteClass(matrixUserId: string): string {
  return SENDER_QUOTE_CLASSES[senderColorIndex(matrixUserId)] ?? SENDER_QUOTE_CLASSES[0];
}

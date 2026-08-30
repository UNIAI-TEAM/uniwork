/** Stable hash → one of eight semantic sender colours (see tokens.css). */
export function senderColorIndex(matrixUserId: string): number {
  const key = matrixUserId.trim().toLowerCase();
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  return hash % SENDER_COLOR_CLASSES.length;
}

export const SENDER_NAME_CLASSES = [
  "text-chat-sender-1",
  "text-chat-sender-2",
  "text-chat-sender-3",
  "text-chat-sender-4",
  "text-chat-sender-5",
  "text-chat-sender-6",
  "text-chat-sender-7",
  "text-chat-sender-8",
] as const;

export const SENDER_DOT_CLASSES = [
  "bg-chat-sender-1",
  "bg-chat-sender-2",
  "bg-chat-sender-3",
  "bg-chat-sender-4",
  "bg-chat-sender-5",
  "bg-chat-sender-6",
  "bg-chat-sender-7",
  "bg-chat-sender-8",
] as const;

export const SENDER_BORDER_CLASSES = [
  "border-chat-sender-1",
  "border-chat-sender-2",
  "border-chat-sender-3",
  "border-chat-sender-4",
  "border-chat-sender-5",
  "border-chat-sender-6",
  "border-chat-sender-7",
  "border-chat-sender-8",
] as const;

const SENDER_COLOR_CLASSES = SENDER_NAME_CLASSES;

export function senderNameClass(matrixUserId: string, isOwn: boolean): string {
  if (isOwn) return "text-brand";
  return SENDER_NAME_CLASSES[senderColorIndex(matrixUserId)] ?? SENDER_NAME_CLASSES[0];
}

export function senderDotClass(matrixUserId: string): string {
  return SENDER_DOT_CLASSES[senderColorIndex(matrixUserId)] ?? SENDER_DOT_CLASSES[0];
}

export function senderBorderClass(matrixUserId: string, isOwn: boolean): string {
  if (isOwn) return "border-brand";
  return SENDER_BORDER_CLASSES[senderColorIndex(matrixUserId)] ?? SENDER_BORDER_CLASSES[0];
}

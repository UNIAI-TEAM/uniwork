export const PENDING_CHAT_MESSAGE_ID_PREFIX = "pending:";

export function pendingChatMessageId(clientMsgId: string): string {
  return `${PENDING_CHAT_MESSAGE_ID_PREFIX}${clientMsgId}`;
}

export function parsePendingChatMessageId(messageId: string): string | null {
  if (!messageId.startsWith(PENDING_CHAT_MESSAGE_ID_PREFIX)) return null;
  const clientMsgId = messageId.slice(PENDING_CHAT_MESSAGE_ID_PREFIX.length);
  return clientMsgId.length > 0 ? clientMsgId : null;
}

export function isPendingChatMessageId(messageId: string): boolean {
  return messageId.startsWith(PENDING_CHAT_MESSAGE_ID_PREFIX);
}

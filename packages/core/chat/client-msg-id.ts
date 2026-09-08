export const CHAT_MESSAGE_BODY_MAX_LENGTH = 4000;

export function newChatClientMsgId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `cmid-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

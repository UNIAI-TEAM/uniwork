import { createContext } from "react";
import type { ChatMessage } from "./chat-messages";

/** Opens the forward dialog for a message; null where forwarding is not offered (no host, or the room turned it off). */
export const ChatForwardContext = createContext<((message: ChatMessage) => void) | null>(null);

/**
 * What the server forwards (chat_forward.go chatForwardPurpose): text —
 * stickers, GIFs and links are text — photos and files, and voice notes. A
 * poll, note, reminder, post, call log or its AI summary stays in its room.
 */
export function isForwardableChatMessage(message: ChatMessage): boolean {
  if (message.deliveryStatus || message.voiceCall || message.voiceCallSummary) return false;
  switch (message.kind ?? "text") {
    case "text":
      return true;
    case "file":
      return Boolean(message.file);
    case "voice":
      return Boolean(message.voice);
    default:
      return false;
  }
}

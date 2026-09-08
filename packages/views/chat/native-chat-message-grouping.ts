import type { ChatMessage } from "./chat-messages";

function isBubbleMessage(message: ChatMessage): boolean {
  return (
    message.kind !== "voice_call_log" &&
    message.kind !== "poll" &&
    message.kind !== "reminder" &&
    message.kind !== "note" &&
    !message.voiceCall
  );
}

const MESSAGE_GROUP_MS = 5 * 60 * 1000;

export function messageGrouping(
  messages: ChatMessage[],
  index: number,
): { compactTop: boolean; showAvatar: boolean } {
  const message = messages[index];
  if (!message || !isBubbleMessage(message)) {
    return { compactTop: false, showAvatar: true };
  }

  for (let i = index - 1; i >= 0; i -= 1) {
    const prev = messages[i];
    if (!prev || !isBubbleMessage(prev)) {
      return { compactTop: false, showAvatar: true };
    }
    const sameSender = prev.sender === message.sender;
    const closeInTime = message.ts - prev.ts < MESSAGE_GROUP_MS;
    return {
      compactTop: sameSender && closeInTime,
      showAvatar: !(sameSender && closeInTime),
    };
  }

  return { compactTop: false, showAvatar: true };
}

import type { ChatMessage } from "./chat-messages";
import { isChatImageContentType, resolveChatFileContentType } from "./chat-file-accept";
import { messageDayKey } from "./chat-message-time";

function isBubbleMessage(message: ChatMessage): boolean {
  return (
    message.kind !== "voice_call_log" &&
    message.kind !== "poll" &&
    message.kind !== "reminder" &&
    message.kind !== "note" &&
    message.kind !== "post" &&
    message.kind !== "file" &&
    !message.voiceCall &&
    !message.voiceCallSummary
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
    const closeInTime =
      message.ts - prev.ts < MESSAGE_GROUP_MS && messageDayKey(prev.ts) === messageDayKey(message.ts);
    return {
      compactTop: sameSender && closeInTime,
      showAvatar: !(sameSender && closeInTime),
    };
  }

  return { compactTop: false, showAvatar: true };
}

const ALBUM_GAP_MS = 2 * 60 * 1000;
const ALBUM_MAX = 10;

/**
 * A photo that may share a bubble with its neighbours. Not a GIF (it carries
 * its own player), and nothing drawn under one message alone — a quote,
 * reactions, a thread link — which an album has no place for.
 */
function isAlbumPhoto(message: ChatMessage): boolean {
  const file = message.file;
  if (message.kind !== "file" || !file || message.deliveryStatus) return false;
  const contentType = resolveChatFileContentType(file);
  if (contentType === "image/gif" || !isChatImageContentType(contentType, file.filename)) return false;
  return !message.replyToEventId && !message.replyCount && Object.keys(message.reactions).length === 0;
}

/**
 * Photos one person sent back to back — nothing between them, each within two
 * minutes of the one before, on one day, at most ten — as [start, end) spans
 * of two or more. `breakBefore` starts a new album at that index (the "Tin
 * mới" line must not fall inside one).
 */
export function imageAlbumSpans(messages: ChatMessage[], breakBefore = -1): { start: number; end: number }[] {
  const photo = messages.map(isAlbumPhoto);
  const spans: { start: number; end: number }[] = [];
  let start = 0;
  for (let i = 1; i <= messages.length; i += 1) {
    const prev = messages[i - 1];
    const cur = messages[i];
    const joins =
      !!prev &&
      !!cur &&
      i !== breakBefore &&
      photo[i - 1] &&
      photo[i] &&
      cur.sender === prev.sender &&
      cur.ts - prev.ts <= ALBUM_GAP_MS &&
      messageDayKey(cur.ts) === messageDayKey(prev.ts) &&
      i - start < ALBUM_MAX;
    if (joins) continue;
    if (i - start >= 2) spans.push({ start, end: i });
    start = i;
  }
  return spans;
}

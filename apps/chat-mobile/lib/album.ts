// Photos one person sent back to back, drawn as one album bubble (canvas
// MobileChat: a 2-column grid). Copied from
// packages/views/chat/native-chat-message-grouping.ts › imageAlbumSpans, on the
// phone's timeline messages: nothing between the photos, each within two
// minutes of the one before, on one day, at most ten; a photo that answers,
// carries reactions or a thread, or was forwarded keeps its own bubble.
import { isChatImageContentType, resolveChatFileContentType } from "./file-accept";
import { messageDayKey, type TimelineMessage } from "./timeline-display";

const ALBUM_GAP_MS = 2 * 60 * 1000;
const ALBUM_MAX = 10;

export function isAlbumPhoto(message: TimelineMessage): boolean {
  const record = message.record;
  const file = record?.file;
  if (!record || message.pending || record.kind !== "file" || !file) return false;
  const contentType = resolveChatFileContentType(file);
  if (contentType === "image/gif" || !isChatImageContentType(contentType, file.filename)) return false;
  const reacted = Object.values(record.reactions ?? {}).some((count) => count > 0);
  return !message.replyToEventId && !(record.reply_count > 0) && !record.forwarded_from && !reacted;
}

/** [start, end) spans of two or more photos, oldest first. */
export function imageAlbumSpans(messages: readonly TimelineMessage[]): { start: number; end: number }[] {
  const photo = messages.map(isAlbumPhoto);
  const spans: { start: number; end: number }[] = [];
  let start = 0;
  for (let i = 1; i <= messages.length; i += 1) {
    const prev = messages[i - 1];
    const cur = messages[i];
    const joins =
      !!prev &&
      !!cur &&
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

/** The album each first photo opens, and the photos it swallows. */
export function albumsOf(messages: readonly TimelineMessage[]): { byFirstId: Map<string, TimelineMessage[]>; folded: Set<string> } {
  const byFirstId = new Map<string, TimelineMessage[]>();
  const folded = new Set<string>();
  for (const { start, end } of imageAlbumSpans(messages)) {
    const photos = messages.slice(start, end);
    byFirstId.set(photos[0]!.id, photos);
    for (const photo of photos.slice(1)) folded.add(photo.id);
  }
  return { byFirstId, folded };
}

// Copied from packages/views/chat/chat-expression-utils.ts (the reading half;
// sending stickers and GIFs is M3); keep in parity (media-body.test.ts).

const MEDIA_MESSAGE_PATTERN = /^!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)$/;

// Hosts the web picker itself produces (Tenor, the offline GIF set, twemoji
// stickers). Any other host stays text: an inline image would fetch from a
// sender-chosen server and tell it who opened the room and when.
const MEDIA_HOSTS = new Set(["media.tenor.com", "media.giphy.com", "cdn.jsdelivr.net"]);

function isAllowedMediaUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && MEDIA_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

export function parseChatMediaMessageBody(body: string): { url: string; alt: string } | null {
  const match = body.trim().match(MEDIA_MESSAGE_PATTERN);
  if (!match?.[1] || !isAllowedMediaUrl(match[1])) return null;
  const altMatch = body.trim().match(/^!\[([^\]]*)\]/);
  return { url: match[1], alt: altMatch?.[1]?.trim() || "media" };
}

export type ChatMediaLabels = { sticker: string; gif: string; image: string };

/**
 * A sticker, GIF or image message in words, for every place that shows a
 * message as one line of text (list preview, reply quote, search). Null when
 * the body is not a media message.
 */
export function describeChatMediaBody(body: string, labels: ChatMediaLabels): string | null {
  const parsed = parseChatMediaMessageBody(body);
  if (!parsed) return null;
  const [prefix, ...rest] = parsed.alt.split(":");
  const name = rest.join(":").trim();
  if (prefix === "sticker") return name ? `${labels.sticker} · ${name}` : labels.sticker;
  if (prefix === "gif" || parsed.url.toLowerCase().includes(".gif")) {
    return name ? `${labels.gif} · ${name}` : labels.gif;
  }
  return labels.image;
}

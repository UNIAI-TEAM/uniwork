const MEDIA_MESSAGE_PATTERN = /^!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)$/;

export function twemojiStickerUrl(emoji: string): string {
  const codePoints = [...emoji]
    .map((char) => char.codePointAt(0)?.toString(16))
    .filter((value): value is string => Boolean(value));
  return `https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/${codePoints.join("-")}.png`;
}

export function formatChatMediaMessageBody(url: string, alt: string): string {
  const safeAlt = alt.replace(/[[\]]/g, "").trim() || "media";
  return `![${safeAlt}](${url})`;
}

export function isChatMediaMessageBody(body: string): boolean {
  return MEDIA_MESSAGE_PATTERN.test(body.trim());
}

export function parseChatMediaMessageBody(body: string): { url: string; alt: string } | null {
  const match = body.trim().match(MEDIA_MESSAGE_PATTERN);
  if (!match?.[1]) return null;
  const altMatch = body.trim().match(/^!\[([^\]]*)\]/);
  return { url: match[1], alt: altMatch?.[1]?.trim() || "media" };
}

export function normalizeExpressionSearchQuery(query: string): string {
  return query.trim().toLowerCase();
}

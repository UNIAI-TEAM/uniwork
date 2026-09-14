import type { ChatMessageLinkRecord } from "../api/endpoints/chat-links";

export const CHAT_TASK_TITLE_MAX = 120;
export const CHAT_TASK_TITLE_WORD_MIN = 40;

/** Default title when the message body is empty (matches server). */
export const EMPTY_CHAT_TASK_TITLE = "Task từ chat";

/**
 * Derive a task title from a chat message body: trim, cap at 120 runes,
 * and prefer a word boundary after the 40th character (same rule as Go).
 */
export function titleFromMessageBody(body: string): string {
  const trimmed = body.trim();
  if (!trimmed) return EMPTY_CHAT_TASK_TITLE;
  const runes = Array.from(trimmed);
  if (runes.length <= CHAT_TASK_TITLE_MAX) return runes.join("");
  let cut = runes.slice(0, CHAT_TASK_TITLE_MAX).join("");
  const boundary = Math.max(
    cut.lastIndexOf(" "),
    cut.lastIndexOf("\t"),
    cut.lastIndexOf("\n"),
  );
  if (boundary > CHAT_TASK_TITLE_WORD_MIN) {
    cut = cut.slice(0, boundary);
  }
  return cut.trim();
}

export function taskLinksOf(links: ChatMessageLinkRecord[]): ChatMessageLinkRecord[] {
  return links.filter((link) => link.target_type === "task");
}

export type WithMessageLinks<T> = T & { links: ChatMessageLinkRecord[] };

/** Attach the links that belong to this message (matched by message id). */
export function attachLinksToMessage<T extends { id: string }>(
  message: T,
  links: ChatMessageLinkRecord[],
): WithMessageLinks<T> {
  return {
    ...message,
    links: links.filter((link) => link.message_id === message.id),
  };
}

/** Attach per-message link lists onto a batch of messages. */
export function attachLinksToMessages<T extends { id: string }>(
  messages: T[],
  linksByMessageId: ReadonlyMap<string, ChatMessageLinkRecord[]> | Record<string, ChatMessageLinkRecord[]>,
): Array<WithMessageLinks<T>> {
  const lookup =
    linksByMessageId instanceof Map
      ? linksByMessageId
      : new Map(Object.entries(linksByMessageId));
  return messages.map((message) => ({
    ...message,
    links: lookup.get(message.id) ?? [],
  }));
}

/** Group a flat link list by message_id. */
export function groupLinksByMessageId(
  links: ChatMessageLinkRecord[],
): Map<string, ChatMessageLinkRecord[]> {
  const map = new Map<string, ChatMessageLinkRecord[]>();
  for (const link of links) {
    const list = map.get(link.message_id);
    if (list) list.push(link);
    else map.set(link.message_id, [link]);
  }
  return map;
}

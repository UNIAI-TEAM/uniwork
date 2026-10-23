import type { ChatMessageRecord } from "@uniwork/core/api/endpoints/chat";
import { parseChatMediaMessageBody } from "./chat-expression-utils";

export type PersonSharedKind = "photo" | "video" | "file" | "link" | "gif" | "group";

export type PersonSharedItem = {
  id: string;
  title: string;
  url?: string;
  thumbUrl?: string;
  expiresAt?: string;
  at: string;
};

export type PersonSharedGroup = {
  id: string;
  roomId: string;
  name: string;
};

export type PersonSharedBuckets = {
  photo: PersonSharedItem[];
  video: PersonSharedItem[];
  file: PersonSharedItem[];
  link: PersonSharedItem[];
  gif: PersonSharedItem[];
};

const URL_PATTERN = /https?:\/\/[^\s<>)\]]+/gi;

function sameId(left: string, right: string): boolean {
  return left.trim().toUpperCase() === right.trim().toUpperCase();
}

function mediaKind(body: string): "sticker" | "gif" | "image" | "video" | null {
  const parsed = parseChatMediaMessageBody(body);
  if (!parsed) return null;
  const prefix = parsed.alt.split(":")[0];
  if (prefix === "sticker") return "sticker";
  if (prefix === "video") return "video";
  if (prefix === "gif" || parsed.url.toLowerCase().split("?")[0]?.endsWith(".gif")) return "gif";
  return "image";
}

function cleanUrl(raw: string): string {
  return raw.replace(/[.,;:!?]+$/, "");
}

/**
 * Photos, files, GIFs and links sent in one conversation.
 * With `senderId`, only that person's messages count.
 */
export function sharedItemsFromMessages(
  messages: readonly ChatMessageRecord[],
  senderId?: string,
): PersonSharedBuckets {
  const photo: PersonSharedItem[] = [];
  const video: PersonSharedItem[] = [];
  const file: PersonSharedItem[] = [];
  const link: PersonSharedItem[] = [];
  const gif: PersonSharedItem[] = [];

  for (const message of messages) {
    if (senderId && !sameId(message.sender_id, senderId)) continue;
    if (message.kind === "file") {
      const type = message.file?.content_type ?? "";
      const title = message.file?.filename?.trim() || message.body.trim();
      const url = message.file?.url || undefined;
      const thumbUrl = message.file?.thumb_url || url;
      const at = message.created_at;
      const expiresAt = message.file?.url_expires_at || undefined;
      if (type === "image/gif") gif.push({ id: message.id, title, url, thumbUrl, expiresAt, at });
      else if (type.startsWith("video/")) video.push({ id: message.id, title, url, thumbUrl, expiresAt, at });
      else if (type.startsWith("image/")) photo.push({ id: message.id, title, url, thumbUrl, expiresAt, at });
      else if (title) file.push({ id: message.id, title, url: message.file?.download_url || url, at });
      continue;
    }

    const kind = mediaKind(message.body);
    if (kind === "sticker") continue;
    if (kind === "gif" || kind === "image" || kind === "video") {
      const parsed = parseChatMediaMessageBody(message.body);
      if (!parsed) continue;
      const item = { id: message.id, title: parsed.alt, url: parsed.url, thumbUrl: parsed.url, at: message.created_at };
      if (kind === "gif") gif.push(item);
      else if (kind === "video") video.push(item);
      else photo.push(item);
      continue;
    }

    if (message.kind !== "text" && message.kind !== "") continue;
    for (const match of message.body.matchAll(URL_PATTERN)) {
      const url = cleanUrl(match[0] ?? "");
      if (!url) continue;
      link.push({ id: `${message.id}:${url}`, title: url, url, at: message.created_at });
    }
  }

  return { photo, video, file, link, gif };
}

type SharedMonthGroup = { key: string; label: string; items: PersonSharedItem[] };

/** Newest month first. The year is part of the label only when it is not this year. */
export function groupSharedItemsByMonth(
  items: readonly PersonSharedItem[],
  locale: string,
  now = new Date(),
): SharedMonthGroup[] {
  const thisYear = new Intl.DateTimeFormat(locale, { month: "long" });
  const otherYear = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" });
  const sorted = [...items].sort((left, right) => Date.parse(right.at) - Date.parse(left.at));
  const groups: SharedMonthGroup[] = [];
  for (const item of sorted) {
    const date = new Date(item.at);
    const valid = !Number.isNaN(date.getTime());
    const key = valid ? `${date.getFullYear()}-${date.getMonth()}` : "unknown";
    const sameYear = valid && date.getFullYear() === now.getFullYear();
    const label = !valid ? "" : sameYear ? thisYear.format(date) : otherYear.format(date);
    const last = groups.at(-1);
    if (last?.key === key) last.items.push(item);
    else groups.push({ key, label, items: [item] });
  }
  return groups;
}

/** Group rooms the other person shares with the caller. Member ids exclude the caller. */
export function groupsInCommon(
  rooms: ReadonlyArray<{ id: string; kind: string; name: string; member_user_ids: readonly string[] }>,
  userId: string,
): PersonSharedGroup[] {
  if (!userId.trim()) return [];
  return rooms
    .filter((room) => room.kind === "group" && room.member_user_ids.some((id) => sameId(id, userId)))
    .map((room) => ({ id: room.id, roomId: room.id, name: room.name }));
}

/** The direct room with this person, when one already exists. */
export function directRoomId(
  rooms: ReadonlyArray<{ id: string; kind: string; peer_user_id?: string }>,
  userId: string,
): string | null {
  if (!userId.trim()) return null;
  return rooms.find((room) => room.kind === "dm" && sameId(room.peer_user_id ?? "", userId))?.id ?? null;
}
